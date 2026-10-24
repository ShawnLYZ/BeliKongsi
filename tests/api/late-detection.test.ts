import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { detectLateDeliveries } from '@/server/modules/fulfilment/late';
import { shopPickupGroup } from '@/server/modules/fulfilment/pickups';
import { personCaller } from '@/server/platform/caller';
import { runDueJobs } from '@/server/modules/jobs/run';
import { createTestApp, type TestApp } from './helpers/app';
import { expectNoMoneyFields } from './helpers/scans';
import { session } from './helpers/sessions';
import {
  consignmentFor,
  countWhatsapp,
  lastWhatsapp,
  pickupOf,
  roundOf,
  supplierOrderOf,
  toFormed,
  toHubChecked,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI_KOPI = seedId('shop', 'KEDAI_KOPI');
const DATE = '2026-11-10';
const KV_IPOH = { hub: 'HUB_KV', destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE };
const KEY = `pp:${PP_IPOH}`;
// Tue 10 Nov 10:00 Malaysia time.
const EXPECTED_READY = '2026-11-10T02:00:00Z';
const JUST_LATE = '2026-11-10T02:00:01Z';

let app: TestApp;

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toHubChecked(app, ['CM']);
});

afterEach(async () => {
  await app.close();
});

/** Sets the time the jobs see, whatever offset the demo's skip to the cut-off left behind. */
async function at(iso: string): Promise<void> {
  const { clockOffsetMs } = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
  app.clock.set(new Date(Date.parse(iso) - Number(clockOffsetMs)).toISOString());
}

const lateRow = () =>
  app.prisma.lateDelivery.findUnique({
    where: {
      shopId_destinationKey_deliveryDate: {
        shopId: KEDAI_KOPI,
        destinationKey: KEY,
        deliveryDate: DATE,
      },
    },
  });

describe('Late goods', () => {
  it('tells owner and staff when goods are late (story 74)', async () => {
    await at(JUST_LATE);
    await detectLateDeliveries(app.deps);
    await detectLateDeliveries(app.deps);
    expect(await countWhatsapp('ahSeng', 'delivery.late')).toBe(1);
    expect(await countWhatsapp('rahim', 'delivery.late')).toBe(1);
    expect(await lastWhatsapp('rahim', 'delivery.late')).toBe(
      "Your goods for Tue 10 Nov are running late. We'll tell you the new date.",
    );
  });

  it('records the late group once, with the time it was expected', async () => {
    await at(JUST_LATE);
    expect((await detectLateDeliveries(app.deps)).detected).toBeGreaterThan(0);
    expect((await detectLateDeliveries(app.deps)).detected).toBe(0);
    expect(await lateRow()).toMatchObject({
      originalExpectedAt: new Date(EXPECTED_READY),
      newExpectedAt: null,
      reason: null,
      detectedAt: new Date(JUST_LATE),
    });
    expect(await app.prisma.lateDelivery.count({ where: { shopId: KEDAI_KOPI } })).toBe(1);
  });

  it('says nothing before the expected ready time', async () => {
    await at(EXPECTED_READY);
    expect((await detectLateDeliveries(app.deps)).detected).toBe(0);
    expect(await countWhatsapp('ahSeng', 'delivery.late')).toBe(0);
    expect(await lateRow()).toBeNull();
  });

  it('says nothing about goods that are ready for pickup', async () => {
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    await app.prisma.pickup.update({ where: { id: pickup.id }, data: { status: 'ready' } });
    await at(JUST_LATE);
    await detectLateDeliveries(app.deps);
    expect(await countWhatsapp('ahSeng', 'delivery.late')).toBe(0);
    expect(await lateRow()).toBeNull();
  });

  it('is part of the due jobs, and a second run finds nothing new', async () => {
    await at(JUST_LATE);
    expect((await runDueJobs(app.deps)).lateDeliveries).toBeGreaterThan(0);
    expect((await runDueJobs(app.deps)).lateDeliveries).toBe(0);
    expect(await countWhatsapp('ahSeng', 'delivery.late')).toBe(1);
  });

  it('links owner and staff to their own pickup pages', async () => {
    await at(JUST_LATE);
    await detectLateDeliveries(app.deps);
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    const link = async (user: 'ahSeng' | 'rahim') =>
      (
        await app.prisma.notification.findFirstOrThrow({
          where: { userId: seedId('user', user), type: 'delivery.late' },
        })
      ).link;
    expect(await link('ahSeng')).toBe(`/owner/pickups/${pickup.id}`);
    expect(await link('rahim')).toBe(`/staff/deliveries/${pickup.id}`);
  });
});

describe('A new date from Ops', () => {
  it('sends the new date that Ops sets', async () => {
    const c = await consignmentFor(KV_IPOH);
    const nadia = await app.as('nadia');
    const res = await nadia.post(`/api/consignments/${c.id}/delay`, {
      newDate: '2026-11-12',
      reason: 'Truck breakdown',
    });
    expect(res.status).toBe(200);
    expect(await lastWhatsapp('ahSeng', 'delivery.new_date')).toBe(
      'New date for your goods: Thu 12 Nov. Reason: Truck breakdown.',
    );
    expect(await lastWhatsapp('rahim', 'delivery.new_date')).toBe(
      'New date for your goods: Thu 12 Nov. Reason: Truck breakdown.',
    );
  });

  it('records the group before detection has found it, ready at 10:00 on the new date', async () => {
    const c = await consignmentFor(KV_IPOH);
    await at('2026-11-09T04:00:00Z');
    await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/delay`, { newDate: '2026-11-12', reason: 'Truck breakdown' });
    expect(await lateRow()).toMatchObject({
      originalExpectedAt: new Date(EXPECTED_READY),
      newExpectedAt: new Date('2026-11-12T02:00:00Z'),
      reason: 'Truck breakdown',
      detectedAt: new Date('2026-11-09T04:00:00Z'),
    });
  });

  it('does not announce lateness again once a date was set before detection', async () => {
    const c = await consignmentFor(KV_IPOH);
    await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/delay`, { newDate: '2026-11-12', reason: 'Truck breakdown' });
    await at(JUST_LATE);
    await detectLateDeliveries(app.deps);
    expect(await countWhatsapp('ahSeng', 'delivery.late')).toBe(0);
  });

  it('refuses a reason that contains an amount, and writes and sends nothing', async () => {
    const c = await consignmentFor(KV_IPOH);
    const res = await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/delay`, {
      newDate: '2026-11-12',
      reason: 'Refund RM 50 owed',
    });
    expect(res).toMatchObject({ status: 422, body: { code: 'REASON_HAS_AMOUNT' } });
    expect(await lateRow()).toBeNull();
    expect(await countWhatsapp('rahim', 'delivery.new_date')).toBe(0);
    expect(await countWhatsapp('ahSeng', 'delivery.new_date')).toBe(0);
  });

  it('keeps the first detection time and changes only the date and reason', async () => {
    await at(JUST_LATE);
    await detectLateDeliveries(app.deps);
    const c = await consignmentFor(KV_IPOH);
    await at('2026-11-10T06:00:00Z');
    await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/delay`, { newDate: '2026-11-13', reason: 'Road closed' });
    expect(await lateRow()).toMatchObject({
      originalExpectedAt: new Date(EXPECTED_READY),
      newExpectedAt: new Date('2026-11-13T02:00:00Z'),
      reason: 'Road closed',
      detectedAt: new Date(JUST_LATE),
    });
  });

  it('sets the date for every shop of a supplier order', async () => {
    const so = await supplierOrderOf((await roundOf('CM', '2026-W45')).id);
    const res = await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${so.id}/delay`, {
      newDate: '2026-11-12',
      reason: 'Supplier delay',
    });
    expect(res.status).toBe(200);
    expect(await lastWhatsapp('ahSeng', 'delivery.new_date')).toBe(
      'New date for your goods: Thu 12 Nov. Reason: Supplier delay.',
    );
    expect(await lastWhatsapp('rahim', 'delivery.new_date')).toBe(
      'New date for your goods: Thu 12 Nov. Reason: Supplier delay.',
    );
    expect(await lateRow()).toMatchObject({ reason: 'Supplier delay' });
    expect(await app.prisma.lateDelivery.count({ where: { reason: 'Supplier delay' } })).toBe(
      (
        await app.prisma.participation.findMany({
          where: { roundId: so.roundId, status: 'allocated' },
          select: { shopId: true, destinationType: true, pickupPointId: true },
        })
      ).reduce(
        (keys, p) =>
          keys.add(`${p.shopId}|${p.destinationType === 'door' ? 'door' : p.pickupPointId}`),
        new Set<string>(),
      ).size,
    );
  });

  it('needs a reason for a new date', async () => {
    const c = await consignmentFor(KV_IPOH);
    const nadia = await app.as('nadia');
    for (const body of [{ newDate: '2026-11-12' }, { newDate: '2026-11-12', reason: '   ' }]) {
      const res = await nadia.post(`/api/consignments/${c.id}/delay`, body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('REASON_REQUIRED');
    }
    expect(await countWhatsapp('ahSeng', 'delivery.new_date')).toBe(0);
    expect(await lateRow()).toBeNull();
  });

  it('refuses a date that is not a calendar date (400)', async () => {
    const c = await consignmentFor(KV_IPOH);
    const res = await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/delay`, { newDate: 'next week', reason: 'Late' });
    expect(res.status).toBe(400);
  });

  it('refuses a date that does not exist (422)', async () => {
    const c = await consignmentFor(KV_IPOH);
    const nadia = await app.as('nadia');
    for (const newDate of ['2026-02-31', '2026-13-45']) {
      const res = await nadia.post(`/api/consignments/${c.id}/delay`, { newDate, reason: 'Late' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_DATE');
    }
    expect(await lateRow()).toBeNull();
    expect(await countWhatsapp('ahSeng', 'delivery.new_date')).toBe(0);
  });

  it('refuses a new date before today in Malaysia (422), and allows today', async () => {
    const c = await consignmentFor(KV_IPOH);
    const nadia = await app.as('nadia');
    // Wed 11 Nov, 00:30 Malaysia time (still Tue 10 Nov in UTC).
    await at('2026-11-10T16:30:00Z');
    const past = await nadia.post(`/api/consignments/${c.id}/delay`, {
      newDate: '2026-11-10',
      reason: 'Truck breakdown',
    });
    expect(past.status).toBe(422);
    expect(past.body.code).toBe('DATE_IN_PAST');
    expect(await lateRow()).toBeNull();
    expect(await countWhatsapp('ahSeng', 'delivery.new_date')).toBe(0);
    const today = await nadia.post(`/api/consignments/${c.id}/delay`, {
      newDate: '2026-11-11',
      reason: 'Truck breakdown',
    });
    expect(today.status).toBe(200);
  });

  it('lets only Ops set a new date', async () => {
    const c = await consignmentFor(KV_IPOH);
    const so = await supplierOrderOf((await roundOf('CM', '2026-W45')).id);
    for (const user of ['ahSeng', 'rahim', 'farid'] as const) {
      const client = await app.as(user);
      const body = { newDate: '2026-11-12', reason: 'Truck breakdown' };
      expect((await client.post(`/api/consignments/${c.id}/delay`, body)).status).toBe(403);
      expect((await client.post(`/api/supplier-orders/${so.id}/delay`, body)).status).toBe(403);
    }
    expect(await lateRow()).toBeNull();
  });

  it('answers 404 for an unknown consignment or supplier order', async () => {
    const nadia = await app.as('nadia');
    const body = { newDate: '2026-11-12', reason: 'Truck breakdown' };
    const none = '00000000-0000-4000-8000-000000000000';
    expect((await nadia.post(`/api/consignments/${none}/delay`, body)).status).toBe(404);
    expect((await nadia.post(`/api/supplier-orders/${none}/delay`, body)).status).toBe(404);
  });

  it('never puts an amount in the staff notice', async () => {
    const c = await consignmentFor(KV_IPOH);
    await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/delay`, { newDate: '2026-11-12', reason: 'Truck breakdown' });
    await at('2026-11-13T03:00:00Z');
    await detectLateDeliveries(app.deps);
    const staffNotices = await app.prisma.notification.findMany({
      where: {
        userId: seedId('user', 'rahim'),
        type: { in: ['delivery.late', 'delivery.new_date'] },
      },
    });
    expect(staffNotices.length).toBeGreaterThan(0);
    for (const n of staffNotices) expect(n.whatsappText).not.toMatch(/RM\s?\d/);
  });
});

describe('The late state in the pickup views', () => {
  const pickupsFor = async (user: 'ahSeng' | 'rahim') => {
    const res = await (await app.as(user)).get(`/api/shops/${KEDAI_KOPI}/pickups`);
    expect(res.status).toBe(200);
    return res.body as { items: { late: Record<string, unknown> | null }[] };
  };

  it('shows owner and staff the late state and new date, with no money for staff', async () => {
    await at(JUST_LATE);
    await detectLateDeliveries(app.deps);
    const c = await consignmentFor(KV_IPOH);
    await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/delay`, { newDate: '2026-11-12', reason: 'Truck breakdown' });
    for (const user of ['ahSeng', 'rahim'] as const) {
      const { items } = await pickupsFor(user);
      expect(items.find((i) => i.late)?.late).toEqual({
        originalExpectedAt: EXPECTED_READY.replace('Z', '.000Z'),
        newExpectedAt: '2026-11-12T02:00:00.000Z',
        reason: 'Truck breakdown',
        cancelFrom: '2026-11-13T02:00:00.000Z',
        canCancelNow: false,
      });
    }
    expectNoMoneyFields(await pickupsFor('rahim'));
    const owner = (await (await app.as('ahSeng')).get(`/api/shops/${KEDAI_KOPI}/pickups`)).body as {
      items: { lines: { readyToCollect: boolean }[] }[];
    };
    expect(owner.items.flatMap((i) => i.lines).every((l) => l.readyToCollect === false)).toBe(true);
  });

  it('gives the owner a page for late goods not yet hub-checked, with their cancel buttons', async () => {
    // The supplier is late: the other rounds are not hub-checked, so they have no pickup yet.
    await at('2026-11-13T02:00:00Z');
    await detectLateDeliveries(app.deps);
    const res = await (
      await app.as('ahSeng')
    ).get(`/api/shops/${KEDAI_KOPI}/pickups?status=upcoming`);
    const group = (
      res.body.items as {
        pickupId: string | null;
        groupKey: string | null;
        deliveryDate: string;
        late: { canCancelNow: boolean } | null;
        lines: { participationId: string; allocationId: string | null }[];
      }[]
    ).find((i) => i.pickupId === null && i.deliveryDate === DATE)!;
    expect(group.groupKey).toBe(`${DATE}.${PP_IPOH}`);
    expect(group.late).toMatchObject({ canCancelNow: true });
    expect(group.lines.length).toBeGreaterThan(0);
    expect(group.lines.every((l) => l.allocationId === null)).toBe(true);

    // The owner's page for the group reads the same view; staff have no such page.
    const owner = personCaller(session('ahSeng', 'owner', { shopId: KEDAI_KOPI }, 'shop'));
    const page = await shopPickupGroup(app.deps, owner, KEDAI_KOPI, group.groupKey!);
    expect(page).toMatchObject({ groupKey: group.groupKey, late: { canCancelNow: true } });
    expect(page!.lines.map((l) => l.participationId)).toEqual(
      group.lines.map((l) => l.participationId),
    );
    expect(await shopPickupGroup(app.deps, owner, KEDAI_KOPI, `${DATE}.door`)).toBeNull();
    const staff = personCaller(session('rahim', 'staff', { shopId: KEDAI_KOPI }, 'shop'));
    await expect(
      shopPickupGroup(app.deps, staff, KEDAI_KOPI, group.groupKey!),
    ).rejects.toMatchObject({ status: 403 });

    // Its "Cancel late item" refunds from the round hold.
    const line = group.lines[0]!;
    const cancelled = await (
      await app.as('ahSeng')
    ).post(`/api/participations/${line.participationId}/late-cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.source).toBe('round_hold');
  });

  it('links the owner to the group page when late goods have no pickup yet', async () => {
    // Back to a clean demo where no round is hub-checked, so no pickup exists yet.
    await app.close();
    app = await createTestApp({ seed: 'demo' });
    await toFormed(app);
    await at(JUST_LATE);
    await detectLateDeliveries(app.deps);
    const link = async (user: 'ahSeng' | 'rahim') =>
      (
        await app.prisma.notification.findFirstOrThrow({
          where: { userId: seedId('user', user), type: 'delivery.late' },
        })
      ).link;
    expect(await link('ahSeng')).toBe(`/owner/pickups/later/${DATE}.${PP_IPOH}`);
    expect(await link('rahim')).toBe('/staff/deliveries');
  });

  it('allows cancelling only once 72 hours have passed', async () => {
    await at('2026-11-13T02:00:00Z');
    await detectLateDeliveries(app.deps);
    const { items } = await pickupsFor('ahSeng');
    expect(items.find((i) => i.late)?.late).toMatchObject({ canCancelNow: true });
  });
});
