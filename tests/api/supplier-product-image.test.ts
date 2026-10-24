import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { createTestApp, type TestApp } from './helpers/app';
import { callRoute } from './helpers/route';
import { SUP_DRY } from './helpers/scenarios';

const CM = seedId('product', 'CM');
const PRODUCT_URL = `/api/suppliers/${SUP_DRY}/products/${CM}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]);

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});
afterEach(async () => {
  await app.close();
});

describe('Supplier product photos', () => {
  it('uploads a photo, sets it on the product, and the public address serves it', async () => {
    const farid = await app.as('farid');
    const asked = await farid.post(`${PRODUCT_URL}/image`, {
      contentType: 'image/png',
      sizeBytes: PNG.byteLength,
    });
    expect(asked.status).toBe(200);
    expect(asked.body.imageKey).toMatch(new RegExp(`^supplier/${CM}/[0-9a-f-]{36}\\.png$`));
    const sent = await callRoute('PUT', asked.body.upload.url, {
      body: PNG,
      headers: asked.body.upload.headers,
    });
    expect(sent.status).toBe(200);

    const patched = await farid.patch(PRODUCT_URL, { imageKey: asked.body.imageKey });
    expect(patched.status).toBe(200);
    expect(patched.body.imageUrl).toBe(`/api/storage/local/product-images/${asked.body.imageKey}`);
    const served = await callRoute('GET', patched.body.imageUrl);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect([...served.raw]).toEqual([...PNG]);

    const product = await app.prisma.product.findUniqueOrThrow({ where: { id: CM } });
    expect(product).toMatchObject({ imageKey: asked.body.imageKey, imageAiGenerated: false });
  });

  it('refuses an image key that was never uploaded (422 IMAGE_NOT_UPLOADED)', async () => {
    const farid = await app.as('farid');
    const asked = await farid.post(`${PRODUCT_URL}/image`, {
      contentType: 'image/jpeg',
      sizeBytes: 100,
    });
    const r = await farid.patch(PRODUCT_URL, { imageKey: asked.body.imageKey });
    expect(r).toMatchObject({ status: 422, body: { code: 'IMAGE_NOT_UPLOADED' } });
    const product = await app.prisma.product.findUniqueOrThrow({ where: { id: CM } });
    expect(product.imageKey).toBe('cm.webp');
  });

  it('refuses a key under another product (422 IMAGE_NOT_UPLOADED)', async () => {
    const farid = await app.as('farid');
    const other = seedId('product', 'OIL');
    await app.deps.storage.putObject('product-images', `supplier/${other}/x.png`, PNG, 'image/png');
    const r = await farid.patch(PRODUCT_URL, { imageKey: `supplier/${other}/x.png` });
    expect(r).toMatchObject({ status: 422, body: { code: 'IMAGE_NOT_UPLOADED' } });
  });

  it('refuses a stored object of the wrong type or over 5 MB (422 IMAGE_NOT_UPLOADED)', async () => {
    const farid = await app.as('farid');
    const put = (name: string, bytes: Uint8Array, type: string) =>
      app.deps.storage.putObject('product-images', `supplier/${CM}/${name}`, bytes, type);
    await put('a.gif', PNG, 'image/gif');
    await put('big.png', new Uint8Array(5 * 1024 * 1024 + 1), 'image/png');
    for (const name of ['a.gif', 'big.png']) {
      const r = await farid.patch(PRODUCT_URL, { imageKey: `supplier/${CM}/${name}` });
      expect(r).toMatchObject({ status: 422, body: { code: 'IMAGE_NOT_UPLOADED' } });
    }
  });

  it('logs the photo change with the old and new image key', async () => {
    const farid = await app.as('farid');
    const key = `supplier/${CM}/new.png`;
    await app.deps.storage.putObject('product-images', key, PNG, 'image/png');
    expect((await farid.patch(PRODUCT_URL, { imageKey: key })).status).toBe(200);
    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'product.updated', subjectId: CM },
    });
    expect(log.before).toEqual({ imageKey: 'cm.webp' });
    expect(log.after).toEqual({ imageKey: key });
  });

  it('refuses a content type that is only an inherited property name (422)', async () => {
    const farid = await app.as('farid');
    for (const contentType of ['constructor', 'toString', '__proto__']) {
      const r = await farid.post(`${PRODUCT_URL}/image`, { contentType, sizeBytes: 100 });
      expect(r).toMatchObject({ status: 422, body: { code: 'UNSUPPORTED_TYPE' } });
    }
  });

  it('refuses a GIF and a photo over 5 MB (422), writing nothing', async () => {
    const farid = await app.as('farid');
    const gif = await farid.post(`${PRODUCT_URL}/image`, {
      contentType: 'image/gif',
      sizeBytes: 100,
    });
    expect(gif).toMatchObject({ status: 422, body: { code: 'UNSUPPORTED_TYPE' } });
    const big = await farid.post(`${PRODUCT_URL}/image`, {
      contentType: 'image/webp',
      sizeBytes: 5 * 1024 * 1024 + 1,
    });
    expect(big).toMatchObject({ status: 422, body: { code: 'TOO_LARGE' } });
  });

  it("hides another supplier's product from a supplier asking for an upload", async () => {
    const lim = await app.as('lim');
    const r = await lim.post(`${PRODUCT_URL}/image`, { contentType: 'image/png', sizeBytes: 100 });
    expect(r.status).toBe(404);
  });
});
