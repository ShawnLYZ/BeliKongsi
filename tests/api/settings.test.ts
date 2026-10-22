/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { distanceKm } from '@/server/adapters/logistics';
import { Client, createTestApp, type TestApp } from './helpers/app';
import { insertShop } from './helpers/builders';
import { expectNoMoneyFields } from './helpers/scans';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});
afterEach(async () => {
  await app.close();
});

const IPOH = { lat: 4.5975, lng: 101.0901 };

async function signInAs(userId: string): Promise<Client> {
  const client = new Client('10.9.9.9');
  const res = await client.post('/api/session', { userId, provider: 'microsoft' });
  expect(res.status).toBe(200);
  return client;
}

describe('pickup points and shop settings', () => {
  it('sorts pickup points by distance from Kedai Kopi Contoh', async () => {
    const res = await (await app.as('ahSeng')).get('/api/pickup-points');
    expect(res.body.items[0]).toMatchObject({
      name: 'Ipoh pickup point',
      openingHours: '10 am–7 pm daily',
    });
    expect(res.body.items.map((p: any) => p.distanceKm)).toEqual(
      [...res.body.items.map((p: any) => p.distanceKm)].sort((a, b) => a - b),
    );
  });

  it('lists pickup points by name, without distances, for Ops', async () => {
    const res = await (await app.as('nadia')).get('/api/pickup-points');
    const names = res.body.items.map((p: any) => p.name);
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual([...names].sort());
    expect(res.body.items.every((p: any) => p.distanceKm === null)).toBe(true);
  });

  it('quotes RM 12.00 when Gerai Contoh chooses door delivery', async () => {
    const res = await (
      await app.as('siti')
    ).patch(`/api/shops/${seedId('shop', 'GERAI')}/settings`, { defaultFulfilment: 'door' });
    expect(res.body.door).toMatchObject({
      feeSen: 1200,
      available: true,
      nearestPickupPoint: { name: 'Johor Bahru pickup point' },
    });
  });

  it('refuses door delivery more than 20 km from a pickup point', async () => {
    const at = { lat: IPOH.lat + 0.2697, lng: IPOH.lng };
    expect(distanceKm(IPOH, at)).toBeGreaterThan(20);
    const { shopId, userId } = await insertShop(app.prisma, at);
    const client = await signInAs(userId);
    const res = await client.patch(`/api/shops/${shopId}/settings`, { defaultFulfilment: 'door' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DOOR_TOO_FAR');
    expect(res.body.message).toBe(
      "Your shop is more than 20 km from the nearest pickup point, so door delivery isn't available. Choose a pickup point instead.",
    );
    const shop = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop.defaultFulfilment).toBe('pickup');
    const view = await client.get(`/api/shops/${shopId}/settings`);
    expect(view.body.door).toMatchObject({ available: false, feeSen: null });
  });

  it('offers door delivery at exactly 20.0 km for RM 18.00', async () => {
    const at = { lat: IPOH.lat + 0.17986, lng: IPOH.lng };
    expect(distanceKm(IPOH, at)).toBe(20);
    const { shopId, userId } = await insertShop(app.prisma, at);
    const res = await (
      await signInAs(userId)
    ).patch(`/api/shops/${shopId}/settings`, { defaultFulfilment: 'door' });
    expect(res.status).toBe(200);
    expect(res.body.door).toMatchObject({
      feeSen: 1800,
      available: true,
      distanceKm: 20,
      nearestPickupPoint: { name: 'Ipoh pickup point' },
    });
  });

  it('lets only the owner change fulfilment (story 102)', async () => {
    expect(
      (
        await (
          await app.as('rahim')
        ).patch(`/api/shops/${seedId('shop', 'KEDAI_KOPI')}/settings`, {
          defaultFulfilment: 'door',
        })
      ).status,
    ).toBe(403);
  });

  it('rejects invalid input with 400, and an unknown pickup point with 400', async () => {
    const owner = await app.as('ahSeng');
    const url = `/api/shops/${seedId('shop', 'KEDAI_KOPI')}/settings`;
    const missing = await owner.patch(url, { defaultFulfilment: 'pickup' });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('INVALID_INPUT');
    expect((await owner.patch(url, { defaultFulfilment: 'teleport' })).status).toBe(400);
    const unknown = await owner.patch(url, {
      defaultFulfilment: 'pickup',
      pickupPointId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('INVALID_INPUT');
  });

  it('shows staff the settings without the delivery fee', async () => {
    const res = await (
      await app.as('rahim')
    ).get(`/api/shops/${seedId('shop', 'KEDAI_KOPI')}/settings`);
    expect(res.status).toBe(200);
    expect(res.body.door.available).toBe(true);
    expect(res.body.door).not.toHaveProperty('feeSen');
    expectNoMoneyFields(res.body);
  });

  it('hides another shop from an owner', async () => {
    const res = await (
      await app.as('ahSeng')
    ).patch(`/api/shops/${seedId('shop', 'GERAI')}/settings`, { defaultFulfilment: 'door' });
    expect(res.status).toBe(404);
  });

  it('changes to a pickup point and logs it by ids only', async () => {
    const shopId = seedId('shop', 'GERAI');
    const jb = seedId('pickup_point', 'PP_JB');
    const res = await (
      await app.as('siti')
    ).patch(`/api/shops/${shopId}/settings`, { defaultFulfilment: 'pickup', pickupPointId: jb });
    expect(res.status).toBe(200);
    expect(res.body.pickupPoint).toMatchObject({ id: jb, name: 'Johor Bahru pickup point' });
    const shop = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop).toMatchObject({ defaultFulfilment: 'pickup', defaultPickupPointId: jb });
    const logs = await app.prisma.activityLogEntry.findMany({
      where: { action: 'shop.settings_changed' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      shopId,
      subjectId: shopId,
      before: { defaultFulfilment: 'door', pickupPointId: null },
      after: { defaultFulfilment: 'pickup', pickupPointId: jb },
    });
    expect(
      JSON.stringify({ before: logs[0]!.before, after: logs[0]!.after, reason: logs[0]!.reason }),
    ).not.toMatch(/Gerai|Johor Bahru/);
  });

  it('completes setup when a shop with a usual list saves its fulfilment', async () => {
    const shopId = seedId('shop', 'KEDAI_KOPI');
    const before = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(before.setupCompletedAt).toBeNull();
    await app.prisma.usualList.create({
      data: { shopId, confirmedAt: app.clock.now(), updatedAt: app.clock.now() },
    });
    const res = await (
      await app.as('ahSeng')
    ).patch(`/api/shops/${shopId}/settings`, {
      defaultFulfilment: 'pickup',
      pickupPointId: seedId('pickup_point', 'PP_IPOH'),
    });
    expect(res.body.setupCompleted).toBe(true);
    const after = await app.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(after.setupCompletedAt).not.toBeNull();
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'shop.setup_completed' } }),
    ).toBe(1);
  });

  it('leaves setup open when the shop has no usual list', async () => {
    const shopId = seedId('shop', 'KEDAI_KOPI');
    expect(await app.prisma.usualList.count({ where: { shopId } })).toBe(0);
    const res = await (
      await app.as('ahSeng')
    ).patch(`/api/shops/${shopId}/settings`, { defaultFulfilment: 'door' });
    expect(res.body.setupCompleted).toBe(false);
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'shop.setup_completed' } }),
    ).toBe(0);
  });

  it.each(['00000000-0000-4000-8000-000000000000', 'abc'])(
    'gives Ops a 404 for settings of shop "%s"',
    async (id) => {
      const res = await (await app.as('nadia')).get(`/api/shops/${id}/settings`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: expect.any(String) });
    },
  );
});
