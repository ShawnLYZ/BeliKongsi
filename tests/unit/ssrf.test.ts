import { describe, expect, it, vi } from 'vitest';
import { assertSafeWebhookUrl, isForbiddenAddress } from '@/server/modules/integration/ssrf';

const OWN = 'http://localhost:3000';

function depsResolving(...addresses: string[]) {
  const lookup = vi.fn(async () => addresses);
  return {
    lookup,
    deps: {
      http: {
        fetch: (() => Promise.reject(new Error('no network'))) as typeof fetch,
        lookup,
      },
    },
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'THREW';
  }
}

describe('isForbiddenAddress', () => {
  it.each([
    '10.0.0.5',
    '127.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fd00::1',
  ])('refuses %s', (ip) => expect(isForbiddenAddress(ip)).toBe(true));

  it.each([
    '0.0.0.0',
    '172.16.0.1',
    '172.31.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '::',
    'fc00::1',
    'fe80::1',
    'fe80::1%eth0',
    'febf::1',
    '::ffff:10.0.0.5',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    'not-an-address',
  ])('also refuses %s', (ip) => expect(isForbiddenAddress(ip)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', 'fec0::1'])(
    'allows the public address %s',
    (ip) => expect(isForbiddenAddress(ip)).toBe(false),
  );
});

describe('assertSafeWebhookUrl', () => {
  it('accepts an HTTPS URL whose every address is public', async () => {
    const { deps } = depsResolving('93.184.216.34', '2606:4700::1111');
    expect(await codeOf(assertSafeWebhookUrl(deps, 'https://hooks.example.com/in', OWN))).toBe(
      null,
    );
  });

  it('refuses plain HTTP to anyone else', async () => {
    const { deps } = depsResolving('93.184.216.34');
    expect(await codeOf(assertSafeWebhookUrl(deps, 'http://hooks.example.com/in', OWN))).toBe(
      'UNSAFE_WEBHOOK_URL',
    );
  });

  it('refuses a hostname when any one of its addresses is private', async () => {
    const { deps } = depsResolving('93.184.216.34', '10.0.0.5');
    expect(await codeOf(assertSafeWebhookUrl(deps, 'https://hooks.example.com/in', OWN))).toBe(
      'UNSAFE_WEBHOOK_URL',
    );
  });

  it('refuses a hostname that does not resolve', async () => {
    const deps = {
      http: {
        fetch: (() => Promise.reject(new Error('no network'))) as typeof fetch,
        lookup: async () => {
          throw new Error('ENOTFOUND');
        },
      },
    };
    expect(await codeOf(assertSafeWebhookUrl(deps, 'https://nowhere.example.com/in', OWN))).toBe(
      'UNSAFE_WEBHOOK_URL',
    );
  });

  it('checks an IP-literal host directly, without a lookup', async () => {
    const { deps, lookup } = depsResolving('93.184.216.34');
    expect(await codeOf(assertSafeWebhookUrl(deps, 'https://127.0.0.1/in', OWN))).toBe(
      'UNSAFE_WEBHOOK_URL',
    );
    expect(await codeOf(assertSafeWebhookUrl(deps, 'https://[::1]/in', OWN))).toBe(
      'UNSAFE_WEBHOOK_URL',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a URL that carries credentials', async () => {
    const { deps } = depsResolving('93.184.216.34');
    expect(await codeOf(assertSafeWebhookUrl(deps, 'https://u:p@hooks.example.com/in', OWN))).toBe(
      'UNSAFE_WEBHOOK_URL',
    );
  });

  it("allows the app's own demo receiver over http on its own origin only", async () => {
    const { deps, lookup } = depsResolving('127.0.0.1');
    expect(await codeOf(assertSafeWebhookUrl(deps, `${OWN}/api/demo/webhook-receiver`, OWN))).toBe(
      null,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(
      await codeOf(
        assertSafeWebhookUrl(deps, 'http://evil.example.com/api/demo/webhook-receiver', OWN),
      ),
    ).toBe('UNSAFE_WEBHOOK_URL');
  });
});
