import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiFetch } from '@/components/common/api-client';
import { actionLabel } from '@/components/common/timeline';
import { verifyResultText } from '@/components/shell/verify-log-button';
import { groupAccounts, homeFor, pageRedirectTarget, type AccountLike } from '@/lib/roles';

const as = (role: 'owner' | 'staff' | 'supplier' | 'ops') => ({ membership: { role } });

describe('page redirects', () => {
  it('sends a visitor without a session to sign-in', () => {
    expect(pageRedirectTarget(null, ['owner'])).toBe('/sign-in');
  });

  it('lets a visitor with an allowed role stay', () => {
    expect(pageRedirectTarget(as('ops'), ['owner', 'ops'])).toBeNull();
  });

  it('sends staff away from an owner page to the staff home', () => {
    expect(pageRedirectTarget(as('staff'), ['owner'])).toBe('/staff');
  });

  it('gives every role its own home', () => {
    expect(['owner', 'staff', 'supplier', 'ops'].map((r) => homeFor(r as never))).toEqual([
      '/owner',
      '/staff',
      '/supplier',
      '/ops',
    ]);
  });
});

describe('seeded account groups', () => {
  const account = (
    displayName: string,
    role: AccountLike['role'],
    orgType: AccountLike['orgType'],
    orgName: string,
  ): AccountLike => ({ userId: displayName, displayName, role, orgType, orgName });

  it('lists shops first, then suppliers, then Ops, with owners before staff', () => {
    const groups = groupAccounts([
      account('Nadia', 'ops', 'operator', 'BeliKongsi Operations'),
      account('Rahim', 'staff', 'shop', 'Kedai Kopi Contoh'),
      account('Farid', 'supplier', 'supplier', 'Pembekal Barang Kering Contoh'),
      account('Ah Seng', 'owner', 'shop', 'Kedai Kopi Contoh'),
      account('Siti', 'owner', 'shop', 'Gerai Contoh'),
    ]);
    expect(groups.map((g) => [g.orgName, g.accounts.map((a) => a.displayName)])).toEqual([
      ['Gerai Contoh', ['Siti']],
      ['Kedai Kopi Contoh', ['Ah Seng', 'Rahim']],
      ['Pembekal Barang Kering Contoh', ['Farid']],
      ['BeliKongsi Operations', ['Nadia']],
    ]);
  });
});

describe('apiFetch', () => {
  function setup(response: () => Promise<Response>) {
    const fetch = vi.fn<typeof globalThis.fetch>(() => response());
    const notify = vi.fn();
    const apiFetch = createApiFetch({
      fetch,
      notify,
      newKey: () => 'key-1',
    });
    return { fetch, notify, apiFetch };
  }

  it('sends a JSON body with an idempotency key on POST', async () => {
    const { fetch, apiFetch } = setup(async () => Response.json({ ok: true }));
    await expect(apiFetch('/api/demo/reset', { body: { a: 1 } })).resolves.toEqual({ ok: true });
    const init = fetch.mock.calls[0]![1]!;
    const headers = new Headers(init.headers);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(headers.get('Idempotency-Key')).toBe('key-1');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('sends no idempotency key on GET', async () => {
    const { fetch, apiFetch } = setup(async () => Response.json({ items: [] }));
    await apiFetch('/api/notifications');
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).has('Idempotency-Key')).toBe(false);
  });

  it('shows the server error message and throws it with its code', async () => {
    const { notify, apiFetch } = setup(async () =>
      Response.json({ code: 'DEMO_OFF', message: 'Demo mode is off.' }, { status: 404 }),
    );
    const error = await apiFetch('/api/demo/reset', { method: 'POST' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'DEMO_OFF', status: 404, message: 'Demo mode is off.' });
    expect(notify).toHaveBeenCalledWith('Demo mode is off.');
  });

  it('says what to do when the server cannot be reached', async () => {
    const { notify, apiFetch } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(apiFetch('/api/session')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(notify).toHaveBeenCalledWith(
      'Could not reach BeliKongsi. Check your connection and try again.',
    );
  });

  it('stays quiet when asked to', async () => {
    const { notify, apiFetch } = setup(async () => new Response('oops', { status: 500 }));
    await expect(apiFetch('/api/session', { quiet: true })).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('shell labels', () => {
  it('reports a valid log with its entry count', () => {
    expect(verifyResultText({ valid: true, count: 12 })).toBe('Valid (12 entries)');
  });

  it('reports the first broken entry', () => {
    expect(verifyResultText({ valid: false, firstBrokenSeq: '7' })).toBe('Broken at entry 7');
  });

  it('names known log actions and spells out new ones', () => {
    expect(actionLabel('shell.signed_in')).toBe('Signed in');
    expect(actionLabel('basket.line_added_by_staff')).toBe('Basket: line added by staff');
  });
});
