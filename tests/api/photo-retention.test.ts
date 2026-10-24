import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { sweepDeletedPhotos } from '@/server/modules/directory/deletion';
import { deletePhotosPastRetention } from '@/server/modules/checks/photo-retention';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import {
  allocationOf,
  consignmentFor,
  moveConsignment,
  pickupOf,
  toHubChecked,
  uploadPhoto,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const KEDAI_ROUNDS = ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];
const DAY = 24 * 60 * 60 * 1000;

let app: TestApp;
let photoId: string;
let claimId: string;
let storageKey: string;
let deleteAfter: Date;

/** Kedai Kopi's check has one damaged carton with one photo, uploaded on 10 Nov. */
beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toHubChecked(app, KEDAI_ROUNDS);
  for (const hub of ['HUB_KV', 'HUB_JOHOR']) {
    const c = await consignmentFor({
      hub,
      destinationKey: `pp:${PP_IPOH}`,
      deliveryDate: '2026-11-10',
    });
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
  }
  const p = await pickupOf('KEDAI_KOPI', '2026-11-10');
  const rahim = await app.as('rahim');
  await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
  const cmAlloc = (await allocationOf('KEDAI_KOPI', 'CM')).id;
  photoId = await uploadPhoto(rahim, p.id);
  const res = await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
    lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photoId] }],
  });
  expect(res.status).toBe(200);
  claimId = res.body.claimId;
  const photo = await app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
  storageKey = photo.storageKey;
  deleteAfter = photo.deleteAfter!;
});

afterEach(async () => {
  await app.close();
});

/** Moves the app's time (the demo clock offset included) to the given moment. */
async function setNow(at: Date) {
  const demo = await app.prisma.demoSettings.findUnique({ where: { id: 1 } });
  const offset = demo?.demoMode ? Number(demo.clockOffsetMs) : 0;
  app.clock.set(new Date(at.getTime() - offset).toISOString());
}

const photo = () => app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } });

describe('deleting delivery photos after 90 days', () => {
  it('keeps a photo at 89 days and deletes it at 90 days', async () => {
    await setNow(new Date(deleteAfter.getTime() - DAY));
    expect(await deletePhotosPastRetention(app.deps)).toEqual({ deleted: 0 });
    expect((await photo()).deletedAt).toBeNull();

    await setNow(deleteAfter);
    expect(await deletePhotosPastRetention(app.deps)).toEqual({ deleted: 1 });
    const row = await photo();
    expect(row.deletedAt).toEqual(deleteAfter);
    expect(row.storagePurgedAt).toEqual(deleteAfter);
    expect(await app.deps.storage.statObject('delivery-photos', storageKey)).toBeNull();
  });

  it('logs the deletion once, without names', async () => {
    await setNow(deleteAfter);
    await deletePhotosPastRetention(app.deps);
    await deletePhotosPastRetention(app.deps);
    const logs = await app.prisma.activityLogEntry.findMany({ where: { action: 'photo.deleted' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ subjectType: 'photo', subjectId: photoId, shopId: KEDAI });
    expect(logs[0]!.after).toMatchObject({ pickupId: expect.any(String) });
  });

  it('shows "photo deleted" on the claim instead of a link', async () => {
    const nadia = await app.as('nadia');
    const before = (await nadia.get(`/api/claims/${claimId}`)).body.lines[0];
    expect(before).toMatchObject({ photosDeleted: 0 });
    expect(before.photoUrls).toHaveLength(1);

    await setNow(deleteAfter);
    await deletePhotosPastRetention(app.deps);
    const after = (await nadia.get(`/api/claims/${claimId}`)).body.lines[0];
    expect(after.photoUrls).toHaveLength(0);
    expect(after.photosDeleted).toBe(1);
    expect(after.photosExpired).toBe(1);
  });

  it('does not count a photo deleted before its 90 days (with its shop) as expired', async () => {
    // The shop deletion marks its photos deleted early, before their delete-after date.
    const early = new Date(deleteAfter.getTime() - 30 * DAY);
    await withTransaction(app.deps, systemCaller('test'), (ctx) =>
      ctx.tx.photo.update({ where: { id: photoId }, data: { deletedAt: early } }),
    );
    const nadia = await app.as('nadia');
    const line = (await nadia.get(`/api/claims/${claimId}`)).body.lines[0];
    expect(line).toMatchObject({ photoUrls: [], photosDeleted: 1, photosExpired: 0 });
  });

  it('marks a photo deleted when its file was already removed by hand', async () => {
    await app.deps.storage.deleteObject('delivery-photos', storageKey);
    await setNow(deleteAfter);
    expect(await deletePhotosPastRetention(app.deps)).toEqual({ deleted: 1 });
    const row = await photo();
    expect(row.deletedAt).not.toBeNull();
    expect(row.storagePurgedAt).not.toBeNull();
  });

  it('treats a "not found" error from storage as success', async () => {
    const deps = {
      ...app.deps,
      storage: {
        ...app.deps.storage,
        deleteObject: async () => {
          throw new Error('Storage delete failed: Object not found');
        },
      },
    } as AppDeps;
    await setNow(deleteAfter);
    await deletePhotosPastRetention(deps);
    expect((await photo()).storagePurgedAt).not.toBeNull();
  });

  it('leaves the file for the sweep to retry when storage fails', async () => {
    const failing = {
      ...app.deps,
      storage: {
        ...app.deps.storage,
        deleteObject: async () => {
          throw new Error('Storage delete failed: timeout');
        },
      },
    } as AppDeps;
    await setNow(deleteAfter);
    expect(await deletePhotosPastRetention(failing)).toEqual({ deleted: 1 });
    const row = await photo();
    expect(row.deletedAt).not.toBeNull();
    expect(row.storagePurgedAt).toBeNull();

    expect(await sweepDeletedPhotos(app.deps)).toEqual({ removed: 1 });
    expect((await photo()).storagePurgedAt).not.toBeNull();
  });
});
