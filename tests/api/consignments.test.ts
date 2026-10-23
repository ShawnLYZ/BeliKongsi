import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { formatPickupCode } from '@/lib/format';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { createTestApp, type TestApp } from './helpers/app';
import {
  consignmentFor,
  feeChargeOf,
  lastWhatsapp,
  moveConsignment,
  pickupOf,
  toHubChecked,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const GERAI = seedId('shop', 'GERAI');
const DATE = '2026-11-10';
const KV_IPOH = { hub: 'HUB_KV', destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE };
const GERAI_DOOR = { hub: 'HUB_KV', destinationKey: `door:${GERAI}`, deliveryDate: DATE };

let app: TestApp;

afterEach(async () => {
  await app.close();
});

describe('Partner status moves', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
  });

  it('refuses a step that skips the order (409)', async () => {
    const c = await consignmentFor(KV_IPOH);
    const res = await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/status`, {
      status: 'arrived',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
    expect((await consignmentFor(KV_IPOH)).status).toBe('planned');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
  });

  it('refuses door-only steps for a pickup point', async () => {
    const c = await consignmentFor(KV_IPOH);
    await moveConsignment(app, c.id, 'dispatched');
    const res = await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/status`, {
      status: 'out_for_delivery',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('refuses the pickup-point arrival for a door consignment', async () => {
    const c = await consignmentFor(GERAI_DOOR);
    await moveConsignment(app, c.id, 'dispatched');
    const res = await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/status`, {
      status: 'arrived',
    });
    expect(res.status).toBe(409);
  });

  it('records each move in the status history, the log and an event', async () => {
    const c = await consignmentFor(KV_IPOH);
    await moveConsignment(app, c.id, 'dispatched');
    const moved = await consignmentFor(KV_IPOH);
    expect(moved.status).toBe('dispatched');
    expect(moved.statusHistory).toEqual([
      expect.objectContaining({ status: 'planned' }),
      expect.objectContaining({
        status: 'dispatched',
        actor: { type: 'person', userId: seedId('user', 'nadia') },
      }),
    ]);
    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'fulfilment.consignment_status_changed', subjectId: c.id },
    });
    expect(log).toMatchObject({ actorType: 'person', subjectType: 'consignment' });
    // The newest one: the history week's consignments moved before this one.
    const event = await app.prisma.integrationEvent.findFirstOrThrow({
      where: { type: 'consignment.status_changed' },
      orderBy: { seq: 'desc' },
    });
    expect(event.data).toEqual({
      consignmentId: c.id,
      hubId: seedId('hub', 'HUB_KV'),
      destinationType: 'pickup_point',
      destinationId: PP_IPOH,
      status: 'dispatched',
    });
  });

  it('lets only Ops move a consignment', async () => {
    const c = await consignmentFor(KV_IPOH);
    for (const user of ['ahSeng', 'rahim', 'farid'] as const) {
      const res = await (
        await app.as(user)
      ).post(`/api/consignments/${c.id}/status`, {
        status: 'dispatched',
      });
      expect(res.status).toBe(403);
    }
    expect((await consignmentFor(KV_IPOH)).status).toBe('planned');
  });

  it('answers 404 for an unknown consignment and 400 for an unknown status', async () => {
    const nadia = await app.as('nadia');
    const missing = await nadia.post(
      '/api/consignments/00000000-0000-4000-8000-000000000000/status',
      { status: 'dispatched' },
    );
    expect(missing.status).toBe(404);
    const c = await consignmentFor(KV_IPOH);
    expect(
      (await nadia.post(`/api/consignments/${c.id}/status`, { status: 'completed' })).status,
    ).toBe(400);
  });
});

describe('Delivery fee handover (PRD §8)', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
  });

  it("hands Gerai Contoh's delivery fee to the partner once at dispatch (PRD §8)", async () => {
    const geraiDoor = await consignmentFor(GERAI_DOOR);
    const charge = await feeChargeOf('GERAI', DATE);
    expect(charge).toMatchObject({ status: 'held', amountSen: 1200 });
    const logisticsBefore = await balanceOf(app.prisma, { kind: 'logistics_payable' });
    await moveConsignment(app, geraiDoor.id, 'dispatched');
    expect(await feeChargeOf('GERAI', DATE)).toMatchObject({ status: 'passed_to_partner' });
    expect(await balanceOf(app.prisma, { kind: 'logistics_payable' })).toBe(logisticsBefore + 1200);
    expect(
      await balanceOf(app.prisma, { kind: 'delivery_fee_hold', shopId: GERAI, deliveryDate: DATE }),
    ).toBe(0);
    // This date's fee only: the history week's fees went to the partner a week earlier.
    const posting = await app.prisma.ledgerPosting.findMany({
      where: { kind: 'delivery_fee_to_partner', paymentId: charge!.paymentId },
    });
    expect(posting).toHaveLength(1);
    expect(Number(posting[0]!.amountSen)).toBe(1200);
  });

  it('moves the fee only once when two door consignments go to one shop', async () => {
    const wave1 = await consignmentFor(GERAI_DOOR);
    await moveConsignment(app, wave1.id, 'dispatched');
    await toHubChecked(app, ['EM']);
    const wave2 = await consignmentFor(GERAI_DOOR);
    expect(wave2).toMatchObject({ wave: 2, status: 'planned' });
    const logisticsAfterFirst = await balanceOf(app.prisma, { kind: 'logistics_payable' });
    await moveConsignment(app, wave2.id, 'dispatched');
    expect(await balanceOf(app.prisma, { kind: 'logistics_payable' })).toBe(logisticsAfterFirst);
    const charge = await feeChargeOf('GERAI', DATE);
    expect(
      await app.prisma.ledgerPosting.count({
        where: { kind: 'delivery_fee_to_partner', paymentId: charge!.paymentId },
      }),
    ).toBe(1);
  });

  it('moves no fee when a pickup-point consignment is dispatched', async () => {
    const before = await balanceOf(app.prisma, { kind: 'logistics_payable' });
    await moveConsignment(app, (await consignmentFor(KV_IPOH)).id, 'dispatched');
    expect(await balanceOf(app.prisma, { kind: 'logistics_payable' })).toBe(before);
  });
});

describe('Pickups follow the consignments', () => {
  it('makes the pickup ready once every consignment has arrived and tells owner and staff (story 70)', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS']);
    const kv = await consignmentFor(KV_IPOH);
    const johor = await consignmentFor({ ...KV_IPOH, hub: 'HUB_JOHOR' });
    await moveConsignment(app, kv.id, 'dispatched');
    await moveConsignment(app, kv.id, 'arrived');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
    await moveConsignment(app, johor.id, 'dispatched');
    await moveConsignment(app, johor.id, 'arrived');

    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('ready');
    const text = `Ready at Ipoh pickup point (10 am–7 pm daily). Pickup code ${formatPickupCode(p.code)}.`;
    expect(await lastWhatsapp('rahim', 'pickup.ready')).toBe(text);
    expect(await lastWhatsapp('ahSeng', 'pickup.ready')).toBe(text);
  });

  it('tells a door shop when its goods are out for delivery (story 72)', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM', 'EM', 'FLOUR', 'CONT']);
    const door = await consignmentFor(GERAI_DOOR);
    await moveConsignment(app, door.id, 'dispatched');
    expect((await pickupOf('GERAI', DATE)).status).toBe('waiting');
    await moveConsignment(app, door.id, 'out_for_delivery');

    const p = await pickupOf('GERAI', DATE);
    expect(p.status).toBe('out_for_delivery');
    expect(await lastWhatsapp('siti', 'pickup.out_for_delivery')).toBe(
      `Your goods are out for delivery today. Have code ${formatPickupCode(p.code)} ready.`,
    );

    // The partner's "delivered" does not hand the goods over: the shop's code does (Ruling B).
    await moveConsignment(app, door.id, 'delivered');
    expect((await consignmentFor(GERAI_DOOR)).status).toBe('delivered');
    expect((await pickupOf('GERAI', DATE)).status).toBe('out_for_delivery');
  });
});

describe('Consignments board', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
  });

  it('lists consignments with map data and the featured round flag', async () => {
    const res = await (await app.as('nadia')).get('/api/ops/consignments');
    expect(res.status).toBe(200);
    const kv = await consignmentFor(KV_IPOH);
    const view = res.body.items.find((c: { consignmentId: string }) => c.consignmentId === kv.id);
    expect(view).toMatchObject({
      consignmentId: kv.id,
      hubName: expect.any(String),
      hubLatLng: { lat: expect.any(Number), lng: expect.any(Number) },
      destinationType: 'pickup_point',
      destinationName: 'Ipoh pickup point',
      destinationLatLng: { lat: expect.any(Number), lng: expect.any(Number) },
      deliveryDate: DATE,
      wave: 1,
      status: 'planned',
      statusHistory: [expect.objectContaining({ status: 'planned' })],
      containsFeaturedRound: true,
      partnerReference: kv.partnerReference,
    });
    const units = await app.prisma.allocation.aggregate({
      where: { consignmentId: kv.id },
      _sum: { allocated: true },
    });
    expect(view.itemCount).toBe(units._sum.allocated);
    const door = res.body.items.find(
      (c: { destinationType: string }) => c.destinationType === 'door',
    );
    expect(door).toMatchObject({ destinationName: expect.stringContaining('Contoh') });
  });

  it('marks consignments without the featured round as such', async () => {
    await toHubChecked(app, ['EGG_A']);
    const johor = await consignmentFor({ ...KV_IPOH, hub: 'HUB_JOHOR' });
    const items = (await (await app.as('nadia')).get('/api/ops/consignments')).body.items;
    expect(
      items.find((c: { consignmentId: string }) => c.consignmentId === johor.id),
    ).toMatchObject({ containsFeaturedRound: false });
  });

  it('filters by status', async () => {
    const kv = await consignmentFor(KV_IPOH);
    await moveConsignment(app, kv.id, 'dispatched');
    const nadia = await app.as('nadia');
    const dispatched = (await nadia.get('/api/ops/consignments?status=dispatched')).body.items;
    expect(dispatched.map((c: { consignmentId: string }) => c.consignmentId)).toEqual([kv.id]);
    const planned = (await nadia.get('/api/ops/consignments?status=planned')).body.items;
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((c: { status: string }) => c.status === 'planned')).toBe(true);
  });

  it('is for Ops only', async () => {
    expect((await (await app.as('ahSeng')).get('/api/ops/consignments')).status).toBe(403);
  });
});
