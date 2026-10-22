import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setDepsForTests } from '@/server/platform/deps';
import { createLocalStorage } from '@/server/adapters/storage/local';
import { callRoute } from './helpers/route';
import { createTestDeps } from './helpers/app';

describe('local storage route', () => {
  let close: () => Promise<void>;
  let dir: string;

  beforeAll(async () => {
    const t = await createTestDeps();
    close = t.close;
    dir = mkdtempSync(join(tmpdir(), 'bk-storage-'));
    t.deps.storage = createLocalStorage({ dir, secret: 'a-session-secret-that-is-long-enough' });
    const webp = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#fff' },
    })
      .webp()
      .toBuffer();
    await t.deps.storage.putObject('product-images', 'cm.webp', webp, 'image/webp');
    await t.deps.storage.putObject('delivery-photos', 'secret.webp', webp, 'image/webp');
    setDepsForTests(t.deps);
  });

  afterAll(async () => {
    setDepsForTests(null);
    await close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves product images publicly from local storage', async () => {
    const res = await callRoute('GET', '/api/storage/local/product-images/cm.webp');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
  });

  it('builds the public URL', () => {
    const s = createLocalStorage({ dir, secret: 'x' });
    expect(s.publicUrl('product-images', 'cm.webp')).toBe(
      '/api/storage/local/product-images/cm.webp',
    );
  });

  it.each([
    '/api/storage/local/product-images/..%2F..%2Fsecret',
    '/api/storage/local/product-images/%2E%2E%2Fdelivery-photos%2Fsecret.webp',
    '/api/storage/local/product-images/..%5Ccm.webp',
    '/api/storage/local/product-images/%2Fetc%2Fpasswd',
    '/api/storage/local/product-images/missing.webp',
    '/api/storage/local/delivery-photos/secret.webp',
    '/api/storage/local/other/cm.webp',
  ])('refuses %s', async (path) => {
    expect((await callRoute('GET', path)).status).toBe(404);
  });

  it('is off unless STORAGE_ADAPTER=local', async () => {
    const t = await createTestDeps();
    try {
      t.deps.env = { ...t.deps.env, STORAGE_ADAPTER: 'supabase' };
      setDepsForTests(t.deps);
      expect((await callRoute('GET', '/api/storage/local/product-images/cm.webp')).status).toBe(
        404,
      );
    } finally {
      await t.close();
    }
  });
});
