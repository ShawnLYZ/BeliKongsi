import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { requestPhotoUpload, photoViewUrl } from '@/server/modules/checks/photos';
import { personCaller } from '@/server/platform/caller';
import { createTestApp, type TestApp } from './helpers/app';
import { callRoute } from './helpers/route';
import { consignmentFor, moveConsignment, pickupOf, toHubChecked } from './helpers/scenarios';
import { session } from './helpers/sessions';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const SUP_DRY = seedId('supplier', 'SUP_DRY');
const DATE = '2026-11-10';
const KEDAI_ROUNDS = ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];

const ahSeng = personCaller(session('ahSeng', 'owner', { shopId: KEDAI }, 'shop'));
const siti = personCaller(session('siti', 'owner', { shopId: GERAI }, 'shop'));
const farid = personCaller(session('farid', 'supplier', { supplierId: SUP_DRY }, 'supplier'));
const nadia = personCaller(
  session('nadia', 'ops', { operatorId: seedId('operator', 'OPS') }, 'operator'),
);

const jpegBytes = (n: number) => new Uint8Array(n).fill(0xff);

let app: TestApp;
let p: Awaited<ReturnType<typeof pickupOf>>;

/** Kedai Kopi's pickup at Ipoh, collected by Rahim. */
beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toHubChecked(app, KEDAI_ROUNDS);
  for (const hub of ['HUB_KV', 'HUB_JOHOR']) {
    const c = await consignmentFor({
      hub,
      destinationKey: `pp:${PP_IPOH}`,
      deliveryDate: DATE,
    });
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
  }
  p = await pickupOf('KEDAI_KOPI', DATE);
  const rahim = await app.as('rahim');
  expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
});

afterEach(async () => {
  await app.close();
});

async function request(contentType = 'image/jpeg', sizeBytes = 2048) {
  const rahim = await app.as('rahim');
  return rahim.post(`/api/pickups/${p.id}/photos`, { contentType, sizeBytes });
}

describe('Delivery photos', () => {
  it('issues a signed upload URL and accepts a small JPEG (story 79)', async () => {
    const rahim = await app.as('rahim');
    const { photoId, upload } = (
      await rahim.post(`/api/pickups/${p.id}/photos`, {
        contentType: 'image/jpeg',
        sizeBytes: 2048,
      })
    ).body;
    expect(
      (await callRoute('PUT', upload.url, { body: jpegBytes(2048), headers: upload.headers }))
        .status,
    ).toBe(200);
    expect(
      await app.deps.storage.statObject('delivery-photos', `pickups/${p.id}/${photoId}.jpg`),
    ).toMatchObject({ sizeBytes: 2048, contentType: 'image/jpeg' });
  });

  it('refuses a second upload to the same signed link and keeps the first photo', async () => {
    const rahim = await app.as('rahim');
    const { photoId, upload } = (
      await rahim.post(`/api/pickups/${p.id}/photos`, {
        contentType: 'image/jpeg',
        sizeBytes: 2048,
      })
    ).body;
    const first = new Uint8Array(2048).fill(0xaa);
    expect(
      (await callRoute('PUT', upload.url, { body: first, headers: upload.headers })).status,
    ).toBe(200);
    const second = await callRoute('PUT', upload.url, {
      body: new Uint8Array(1024).fill(0xbb),
      headers: upload.headers,
    });
    expect(second).toMatchObject({ status: 409, body: { code: 'ALREADY_UPLOADED' } });
    const stored = await (
      app.deps.storage as unknown as {
        getObject(b: string, k: string): Promise<Uint8Array | null>;
      }
    ).getObject('delivery-photos', `pickups/${p.id}/${photoId}.jpg`);
    expect(Buffer.from(stored!).equals(Buffer.from(first))).toBe(true);
  });

  it('records the photo for 90 days with who uploaded it', async () => {
    const { photoId } = (await request()).body;
    const photo = await app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    expect(photo).toMatchObject({
      pickupId: p.id,
      storageKey: `pickups/${p.id}/${photoId}.jpg`,
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      uploadedByUserId: seedId('user', 'rahim'),
      deletedAt: null,
    });
    expect(photo.deleteAfter.getTime() - photo.uploadedAt.getTime()).toBe(90 * 24 * 3600 * 1000);
  });

  it('lets the owner ask for an upload link too', async () => {
    const ahSengClient = await app.as('ahSeng');
    const res = await ahSengClient.post(`/api/pickups/${p.id}/photos`, {
      contentType: 'image/png',
      sizeBytes: 100,
    });
    expect(res.status).toBe(200);
    expect(res.body.upload).toMatchObject({ method: 'PUT' });
  });

  it('refuses PDFs and photos over 5 MB before storing anything', async () => {
    const pdf = await request('application/pdf', 100);
    expect(pdf.status).toBe(422);
    expect(pdf.body.code).toBe('UNSUPPORTED_TYPE');
    const big = await request('image/jpeg', 6 * 1024 * 1024);
    expect(big.status).toBe(422);
    expect(big.body.code).toBe('TOO_LARGE');
    expect(await app.prisma.photo.count()).toBe(0);
  });

  it('stops an upload bigger than the size it asked for, or of another type (422)', async () => {
    const { upload } = (await request('image/jpeg', 100)).body;
    const bigger = await callRoute('PUT', upload.url, {
      body: jpegBytes(101),
      headers: upload.headers,
    });
    expect(bigger.status).toBe(422);
    const wrongType = await callRoute('PUT', upload.url, {
      body: jpegBytes(100),
      headers: { 'content-type': 'application/pdf' },
    });
    expect(wrongType.status).toBe(422);
  });

  it('refuses a tampered link (403)', async () => {
    const { upload } = (await request()).body;
    const url = new URL('http://localhost' + upload.url);
    const sig = url.searchParams.get('sig')!;
    url.searchParams.set('sig', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1));
    const bad = await callRoute('PUT', url.pathname + url.search, {
      body: jpegBytes(10),
      headers: upload.headers,
    });
    expect(bad.status).toBe(403);
    // A larger max than was signed is also refused.
    url.searchParams.set('sig', sig);
    url.searchParams.set('max', '999999');
    const bigger = await callRoute('PUT', url.pathname + url.search, {
      body: jpegBytes(10),
      headers: upload.headers,
    });
    expect(bigger.status).toBe(403);
    expect(
      await app.deps.storage.statObject('delivery-photos', `pickups/${p.id}/x.jpg`),
    ).toBeNull();
  });

  it('refuses an upload link after 10 minutes (403)', async () => {
    const { upload } = (await request()).body;
    app.clock.advance(10 * 60 * 1000 + 1000);
    const late = await callRoute('PUT', upload.url, {
      body: jpegBytes(10),
      headers: upload.headers,
    });
    expect(late.status).toBe(403);
  });

  it('serves a photo through its view link for 10 minutes only', async () => {
    const { photoId, upload } = (await request()).body;
    await callRoute('PUT', upload.url, { body: jpegBytes(2048), headers: upload.headers });
    const link = await photoViewUrl(app.deps, ahSeng, photoId);
    const ok = await callRoute('GET', link);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');

    const url = new URL('http://localhost' + link);
    const sig = url.searchParams.get('sig')!;
    url.searchParams.set('sig', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1));
    expect((await callRoute('GET', url.pathname + url.search)).status).toBe(403);

    app.clock.advance(10 * 60 * 1000 + 1000);
    expect((await callRoute('GET', link)).status).toBe(403);
  });

  it('never serves a delivery photo without a signature', async () => {
    const { photoId } = (await request()).body;
    const key = `pickups/${p.id}/${photoId}.jpg`;
    expect((await callRoute('GET', `/api/storage/local/delivery-photos/${key}`)).status).toBe(404);
  });

  it("keeps photos to the shop's members and Ops (story 147)", async () => {
    const sitiClient = await app.as('siti');
    const res = await sitiClient.post(`/api/pickups/${p.id}/photos`, {
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(res.status).toBe(404);
    await expect(
      requestPhotoUpload(app.deps, siti, p.id, { contentType: 'image/jpeg', sizeBytes: 10 }),
    ).rejects.toMatchObject({ status: 404 });

    const { photoId } = (await request()).body;
    expect(await photoViewUrl(app.deps, ahSeng, photoId)).toContain('delivery-photos');
    expect(await photoViewUrl(app.deps, nadia, photoId)).toContain('delivery-photos');
    await expect(photoViewUrl(app.deps, farid, photoId)).rejects.toMatchObject({ status: 404 });
    await expect(photoViewUrl(app.deps, siti, photoId)).rejects.toMatchObject({ status: 404 });
  });

  it('does not let Ops upload (403) or take photos of goods not yet handed over (409)', async () => {
    const nadiaClient = await app.as('nadia');
    const ops = await nadiaClient.post(`/api/pickups/${p.id}/photos`, {
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(ops.status).toBe(403);

    await app.prisma.pickup.update({ where: { id: p.id }, data: { status: 'ready' } });
    const early = await request();
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('NOT_COLLECTED');
  });
});
