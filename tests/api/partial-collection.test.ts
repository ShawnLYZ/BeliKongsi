import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { formatPickupCode } from '@/lib/format';
import { detectLateDeliveries } from '@/server/modules/fulfilment/late';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { createTestApp, type TestApp } from './helpers/app';
import { expectNoMoneyFields } from './helpers/scans';
import {
  allocationOf,
  consignmentFor,
  countWhatsapp,
  feeChargeOf,
  lastWhatsapp,
  moveConsignment,
  opsApprovalOf,
  participationOf,
  pickupOf,
  roundOf,
  supplierOrderOf,
  toHubChecked,
  uploadPhoto,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const DATE = '2026-11-10';
const KV_IPOH = { hub: 'HUB_KV', destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE };
const JOHOR_IPOH = { ...KV_IPOH, hub: 'HUB_JOHOR' };
const GERAI_DOOR = { hub: 'HUB_KV', destinationKey: `door:${GERAI}`, deliveryDate: DATE };
// Every round Kedai Kopi Contoh has a line in; its eggs come from Johor, the rest from KV.
const KEDAI_ROUNDS = ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];

let app: TestApp;

afterEach(async () => {
  await app.close();
});

/** An hour later, a consignment reaches its pickup point (so each part has its own time). */
async function arrive(where: typeof KV_IPOH) {
  app.clock.advance(60 * 60 * 1000);
  const c = await consignmentFor(where);
  await moveConsignment(app, c.id, 'dispatched');
  await moveConsignment(app, c.id, 'arrived');
}

const collections = (pickupId: string) =>
  app.prisma.pickupCollection.findMany({
    where: { pickupId },
    orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
    include: { allocations: { select: { id: true } } },
  });

describe('Collecting at the pickup point in two parts', () => {
  let p: Awaited<ReturnType<typeof pickupOf>>;

  /** All of Kedai Kopi's rounds are hub-checked; only the Johor eggs have reached Ipoh. */
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    await arrive(JOHOR_IPOH);
    p = await pickupOf('KEDAI_KOPI', DATE);
  });

  it('marks the pickup partly ready and tells owner and staff', async () => {
    expect(p.status).toBe('partly_ready');
    const text = `Part of your goods is ready at Ipoh pickup point (10 am–7 pm daily). Pickup code ${formatPickupCode(p.code)}.`;
    expect(await lastWhatsapp('ahSeng', 'pickup.partly_ready')).toBe(text);
    expect(await lastWhatsapp('rahim', 'pickup.partly_ready')).toBe(text);
  });

  it('lets staff collect what has arrived and the rest later with the same code', async () => {
    const rahim = await app.as('rahim');
    const first = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(first.status).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
    const [one] = await collections(p.id);
    expect(one!.allocations.map((a) => a.id)).toEqual([
      (await allocationOf('KEDAI_KOPI', 'EGG_A')).id,
    ]);
    expect(one).toMatchObject({ method: 'code', collectedByUserId: seedId('user', 'rahim') });

    await arrive(KV_IPOH);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
    const second = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(second.status).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('collected');
    expect(await app.prisma.pickupCollection.count({ where: { pickupId: p.id } })).toBe(2);
    const [, two] = await collections(p.id);
    expect(two!.allocations).toHaveLength(4);
  });

  it('refuses the code again while nothing more has arrived', async () => {
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    const again = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(again).toMatchObject({ status: 409, body: { code: 'NOT_READY' } });
    expect(await app.prisma.pickupCollection.count({ where: { pickupId: p.id } })).toBe(1);
  });

  it('shows each collection with its goods and whether it was checked, without money', async () => {
    const rahim = await app.as('rahim');
    const res = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expectNoMoneyFields(res.body);
    const [one] = await collections(p.id);
    expect(res.body.collections).toEqual([
      {
        collectionId: one!.id,
        collectedAt: one!.collectedAt.toISOString(),
        checked: false,
        checkResult: null,
        claimId: null,
        lines: [expect.objectContaining({ productName: expect.any(String), quantity: 10 })],
      },
    ]);
    // Every line of the pickup is still listed, collected or not.
    expect(res.body.lines).toHaveLength(5);
  });
});

describe('Collecting what arrived while another round is not hub-checked yet', () => {
  it('lets the arrived goods go first, then the eggs once they are checked and arrive', async () => {
    app = await createTestApp({ seed: 'demo' });
    // Everything but the eggs is hub-checked, and that KV consignment reaches Ipoh.
    await toHubChecked(
      app,
      KEDAI_ROUNDS.filter((k) => k !== 'EGG_A'),
    );
    await arrive(KV_IPOH);
    expect((await participationOf('KEDAI_KOPI', 'EGG_A')).status).toBe('kept');
    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('partly_ready');

    // The owner sees the arrived goods as ready to collect, and the eggs as still to come.
    const ah = await app.as('ahSeng');
    const view = async () => {
      const res = await ah.get(`/api/shops/${KEDAI}/pickups?status=upcoming`);
      return res.body.items as {
        pickupId: string | null;
        lines: { productName: string; readyToCollect: boolean }[];
      }[];
    };
    const before = await view();
    const planned = before.find((v) => v.pickupId === p.id)!;
    expect(planned.lines).toHaveLength(4);
    expect(planned.lines.every((l) => l.readyToCollect)).toBe(true);
    const later = before.find((v) => v.pickupId === null)!;
    expect(later.lines.map((l) => l.readyToCollect)).toEqual([false]);

    const rahim = await app.as('rahim');
    const first = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(first.status).toBe(200);
    // The eggs are still to come, so the pickup waits for them rather than being collected.
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
    expect(
      (await rahim.post(`/api/pickups/${p.id}/delivery-check`, { allReceived: true })).status,
    ).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');

    await toHubChecked(app, ['EGG_A']);
    expect((await pickupOf('KEDAI_KOPI', DATE)).id).toBe(p.id);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
    await arrive(JOHOR_IPOH);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
    const second = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(second.status).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('collected');
    const [one, two] = await collections(p.id);
    expect(one!.allocations).toHaveLength(4);
    expect(two!.allocations.map((a) => a.id)).toEqual([
      (await allocationOf('KEDAI_KOPI', 'EGG_A')).id,
    ]);
  });

  it('goes back to waiting when the arrived part is cancelled late while eggs are still to come', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
    const p = await pickupOf('KEDAI_KOPI', DATE);
    const { clockOffsetMs } = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
    // 72 hours after Tue 10 Nov 10:00 Malaysia time: the group is late and nothing arrived yet.
    app.clock.set(
      new Date(Date.parse('2026-11-13T02:00:00Z') - Number(clockOffsetMs)).toISOString(),
    );
    const round = await app.prisma.round.findUniqueOrThrow({
      where: { id: (await participationOf('KEDAI_KOPI', 'CM')).roundId },
    });
    await app.prisma.lateDelivery.create({
      data: {
        shopId: KEDAI,
        destinationKey: p.destinationKey,
        deliveryDate: DATE,
        originalExpectedAt: round.expectedReadyAt,
        detectedAt: round.expectedReadyAt,
      },
    });
    const c = await consignmentFor(KV_IPOH);
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
    // Other rounds of the group are still not hub-checked, yet the condensed milk can go.
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('partly_ready');
    const cm = await participationOf('KEDAI_KOPI', 'CM');
    expect(
      (await (await app.as('ahSeng')).post(`/api/participations/${cm.id}/late-cancel`)).status,
    ).toBe(200);
    expect(await pickupOf('KEDAI_KOPI', DATE)).toMatchObject({ status: 'waiting', readyAt: null });
    const res = await (
      await app.as('rahim')
    ).post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(res).toMatchObject({ status: 409, body: { code: 'NOT_READY' } });
  });
});

describe('Checking each collection', () => {
  let p: Awaited<ReturnType<typeof pickupOf>>;
  let first: string;
  let second: string;
  let eggAlloc: string;
  let cmAlloc: string;

  /** Kedai Kopi collected its eggs, then the rest, without checking in between. */
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    await arrive(JOHOR_IPOH);
    p = await pickupOf('KEDAI_KOPI', DATE);
    const rahim = await app.as('rahim');
    await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    await arrive(KV_IPOH);
    await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    [first, second] = (await collections(p.id)).map((c) => c.id) as [string, string];
    eggAlloc = (await allocationOf('KEDAI_KOPI', 'EGG_A')).id;
    cmAlloc = (await allocationOf('KEDAI_KOPI', 'CM')).id;
  });

  async function check(body: unknown) {
    const rahim = await app.as('rahim');
    return rahim.post(`/api/pickups/${p.id}/delivery-check`, body);
  }

  it('needs a check for each collection before the pickup closes', async () => {
    const one = await check({ allReceived: true, collectionId: first });
    expect(one).toMatchObject({ status: 200, body: { result: 'all_received' } });
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('collected');
    expect((await participationOf('KEDAI_KOPI', 'EGG_A')).status).toBe('closed');
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('allocated');

    const two = await check({ allReceived: true, collectionId: second });
    expect(two.status).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('closed');
    expect(await app.prisma.deliveryCheck.count({ where: { pickupId: p.id } })).toBe(2);
  });

  it('asks which collection when several are unchecked (422)', async () => {
    const res = await check({ allReceived: true });
    expect(res).toMatchObject({ status: 422, body: { code: 'COLLECTION_REQUIRED' } });
    expect(await app.prisma.deliveryCheck.count({ where: { pickupId: p.id } })).toBe(0);
  });

  it('checks the only unchecked collection when none is named', async () => {
    await check({ allReceived: true, collectionId: first });
    expect((await check({ allReceived: true })).status).toBe(200);
    const dc = await app.prisma.deliveryCheck.findUniqueOrThrow({
      where: { collectionId: second },
    });
    expect(dc.result).toBe('all_received');
  });

  it('refuses a second check of the same collection (409)', async () => {
    await check({ allReceived: true, collectionId: first });
    const again = await check({ allReceived: true, collectionId: first });
    expect(again).toMatchObject({ status: 409, body: { code: 'CHECK_EXISTS' } });
  });

  it('gives one check when the same collection is submitted twice at once', async () => {
    const [a, b] = await Promise.all([
      check({ allReceived: true, collectionId: first }),
      check({ allReceived: true, collectionId: first }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await app.prisma.deliveryCheck.count({ where: { collectionId: first } })).toBe(1);
  });

  it("answers 404 for another pickup's collection", async () => {
    const elsewhere = await app.prisma.pickupCollection.findFirstOrThrow({
      where: { pickupId: { not: p.id } },
    });
    const res = await check({ allReceived: true, collectionId: elsewhere.id });
    expect(res.status).toBe(404);
  });

  it("limits the lines to the collection's goods", async () => {
    const res = await check({
      collectionId: first,
      lines: [{ allocationId: cmAlloc, missing: 1, damaged: 0, photoIds: [] }],
    });
    expect(res).toMatchObject({
      status: 422,
      body: { code: 'UNKNOWN_LINE', details: { allocationId: cmAlloc } },
    });
  });

  it('keeps the pickup open until the claim on a collection is decided', async () => {
    const rahim = await app.as('rahim');
    const photo = await uploadPhoto(rahim, p.id);
    const res = await check({
      collectionId: first,
      lines: [{ allocationId: eggAlloc, missing: 0, damaged: 1, photoIds: [photo] }],
    });
    expect(res.status).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('collected');
    await check({ allReceived: true, collectionId: second });
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('checked');

    const claim = await app.prisma.claim.findUniqueOrThrow({ where: { id: res.body.claimId } });
    const nadia = await app.as('nadia');
    expect((await nadia.post(`/api/approvals/${claim.approvalRequestId}/approve`, {})).status).toBe(
      200,
    );
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
    expect((await participationOf('KEDAI_KOPI', 'EGG_A')).status).toBe('closed');
  });

  it('shows which collections are checked', async () => {
    await check({ allReceived: true, collectionId: first });
    const rahim = await app.as('rahim');
    const res = await rahim.get(`/api/shops/${KEDAI}/pickups`);
    const view = res.body.items.find((v: { pickupId: string }) => v.pickupId === p.id);
    expect(
      view.collections.map((c: { collectionId: string; checked: boolean }) => [
        c.collectionId,
        c.checked,
      ]),
    ).toEqual([
      [first, true],
      [second, false],
    ]);
    expectNoMoneyFields(res.body);
  });
});

describe('Door delivery in two parts', () => {
  it('charges no extra delivery fee for a second door delivery', async () => {
    app = await createTestApp({ seed: 'demo' });
    // Gerai's first goods leave in wave 1; egg mayo is hub-checked after, so it goes in wave 2.
    await toHubChecked(app, ['CM', 'FLOUR', 'CONT']);
    const wave1 = await consignmentFor(GERAI_DOOR);
    await moveConsignment(app, wave1.id, 'dispatched');
    await toHubChecked(app, ['EM']);
    const wave2 = await consignmentFor(GERAI_DOOR);
    expect(wave2.wave).toBe(2);
    const logistics = await balanceOf(app.prisma, { kind: 'logistics_payable' });

    await moveConsignment(app, wave1.id, 'out_for_delivery');
    await moveConsignment(app, wave1.id, 'delivered');
    const p = await pickupOf('GERAI', DATE);
    expect(p.status).toBe('partly_ready');
    const siti = await app.as('siti');
    const delivered = await countWhatsapp('siti', 'pickup.delivered');
    expect((await siti.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    expect((await pickupOf('GERAI', DATE)).status).toBe('waiting');

    await moveConsignment(app, wave2.id, 'dispatched');
    await moveConsignment(app, wave2.id, 'out_for_delivery');
    expect((await pickupOf('GERAI', DATE)).status).toBe('out_for_delivery');
    expect((await siti.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    expect((await pickupOf('GERAI', DATE)).status).toBe('delivered');
    expect(await app.prisma.pickupCollection.count({ where: { pickupId: p.id } })).toBe(2);

    const charges = await app.prisma.deliveryFeeCharge.findMany({
      where: { shopId: GERAI, deliveryDate: DATE },
    });
    expect(charges).toHaveLength(1);
    expect(charges[0]!.amountSen).toBe(1200);
    expect(await balanceOf(app.prisma, { kind: 'logistics_payable' })).toBe(logistics);
    const charge = await feeChargeOf('GERAI', DATE);
    expect(
      await app.prisma.ledgerPosting.count({
        where: { kind: 'delivery_fee_to_partner', paymentId: charge!.paymentId },
      }),
    ).toBe(1);
    expect(await countWhatsapp('siti', 'pickup.delivered')).toBe(delivered + 2);
  });
});

describe('Cancelling the rest of a partly collected pickup', () => {
  it('closes the pickup once the last late item left is cancelled', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    await arrive(JOHOR_IPOH);
    const p = await pickupOf('KEDAI_KOPI', DATE);
    const rahim = await app.as('rahim');
    await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    await rahim.post(`/api/pickups/${p.id}/delivery-check`, { allReceived: true });
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');

    // 72 hours after Tue 10 Nov 10:00 Malaysia time, whatever offset the demo left behind.
    const { clockOffsetMs } = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
    app.clock.set(
      new Date(Date.parse('2026-11-13T02:00:00Z') - Number(clockOffsetMs)).toISOString(),
    );
    const ah = await app.as('ahSeng');
    const rest = ['CM', 'OIL', 'COFFEE', 'CUPS'];
    for (const key of rest) {
      const part = await participationOf('KEDAI_KOPI', key);
      expect((await ah.post(`/api/participations/${part.id}/late-cancel`)).status).toBe(200);
      const expected = key === 'CUPS' ? 'closed' : 'waiting';
      expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe(expected);
    }
  });

  it('goes back to waiting when the part ready to collect is cancelled late', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    const p = await pickupOf('KEDAI_KOPI', DATE);
    // The group was found late before anything arrived.
    const round = await app.prisma.round.findUniqueOrThrow({
      where: { id: (await participationOf('KEDAI_KOPI', 'EGG_A')).roundId },
    });
    await app.prisma.lateDelivery.create({
      data: {
        shopId: KEDAI,
        destinationKey: p.destinationKey,
        deliveryDate: DATE,
        originalExpectedAt: round.expectedReadyAt,
        detectedAt: round.expectedReadyAt,
      },
    });
    const { clockOffsetMs } = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
    app.clock.set(
      new Date(Date.parse('2026-11-13T02:00:00Z') - Number(clockOffsetMs)).toISOString(),
    );
    const johor = await consignmentFor(JOHOR_IPOH);
    await moveConsignment(app, johor.id, 'dispatched');
    await moveConsignment(app, johor.id, 'arrived');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('partly_ready');

    const eggs = await participationOf('KEDAI_KOPI', 'EGG_A');
    const ah = await app.as('ahSeng');
    expect((await ah.post(`/api/participations/${eggs.id}/late-cancel`)).status).toBe(200);
    const after = await pickupOf('KEDAI_KOPI', DATE);
    expect(after).toMatchObject({ status: 'waiting', readyAt: null });
    const rahim = await app.as('rahim');
    const res = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(res).toMatchObject({ status: 409, body: { code: 'NOT_READY' } });
  });
});

/** Sets the time the code sees, whatever offset the demo's skip to the cut-off left behind. */
async function at(iso: string): Promise<void> {
  const { clockOffsetMs } = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
  app.clock.set(new Date(Date.parse(iso) - Number(clockOffsetMs)).toISOString());
}

describe('The rest of a pickup leaving without ever being planned', () => {
  let p: Awaited<ReturnType<typeof pickupOf>>;

  /**
   * Everything but the eggs is hub-checked and reaches Ipoh; Kedai Kopi collects and checks it,
   * so its pickup waits for the eggs alone. Every other shop's pickup is done.
   */
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(
      app,
      KEDAI_ROUNDS.filter((k) => k !== 'EGG_A'),
    );
    await arrive(KV_IPOH);
    p = await pickupOf('KEDAI_KOPI', DATE);
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    expect(
      (await rahim.post(`/api/pickups/${p.id}/delivery-check`, { allReceived: true })).status,
    ).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
    await app.prisma.pickup.updateMany({
      where: { id: { not: p.id } },
      data: { status: 'closed' },
    });
  });

  it('closes the pickup and completes its rounds when the eggs are cancelled late before the hub', async () => {
    // 72 hours after Tue 10 Nov 10:00 Malaysia time.
    await at('2026-11-13T02:00:00Z');
    const eggs = await participationOf('KEDAI_KOPI', 'EGG_A');
    expect(eggs.status).toBe('kept');
    const res = await (await app.as('ahSeng')).post(`/api/participations/${eggs.id}/late-cancel`);
    expect(res).toMatchObject({ status: 200, body: { source: 'round_hold' } });
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
    expect((await roundOf('CM', '2026-W45')).status).toBe('completed');
  });

  it('closes the pickup when the eggs round is cancelled instead', async () => {
    const order = await supplierOrderOf((await roundOf('EGG_A', '2026-W45')).id);
    const rejected = await (
      await app.as('nadia')
    ).post(`/api/approvals/${await opsApprovalOf(order.id)}/reject`, {
      reason: 'Supplier price dispute',
    });
    expect(rejected.status).toBe(200);
    expect((await participationOf('KEDAI_KOPI', 'EGG_A')).status).toBe('refunded_round_cancelled');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
    expect((await roundOf('CM', '2026-W45')).status).toBe('completed');
  });
});

describe('A partly ready pickup with a round still to come', () => {
  it('is late when that round is overdue, and the owner can cancel it late', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(
      app,
      KEDAI_ROUNDS.filter((k) => k !== 'EGG_A'),
    );
    await arrive(KV_IPOH);
    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('partly_ready');

    // Just past Tue 10 Nov 10:00 Malaysia time, the eggs are not even at the hub.
    await at('2026-11-10T02:00:01Z');
    await detectLateDeliveries(app.deps);
    expect(
      await app.prisma.lateDelivery.count({
        where: { shopId: KEDAI, destinationKey: p.destinationKey, deliveryDate: DATE },
      }),
    ).toBe(1);
    expect(await countWhatsapp('ahSeng', 'delivery.late')).toBe(1);
    expect(await countWhatsapp('rahim', 'delivery.late')).toBe(1);

    await at('2026-11-13T02:00:00Z');
    const eggs = await participationOf('KEDAI_KOPI', 'EGG_A');
    const res = await (await app.as('ahSeng')).post(`/api/participations/${eggs.id}/late-cancel`);
    expect(res).toMatchObject({ status: 200, body: { source: 'round_hold' } });
    // Nothing else is to come, so what arrived is the whole pickup now.
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
  });

  it('is not late once nothing more is to come', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    await arrive(JOHOR_IPOH);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('partly_ready');
    await at('2026-11-10T02:00:01Z');
    await detectLateDeliveries(app.deps);
    expect(await app.prisma.lateDelivery.count({ where: { shopId: KEDAI } })).toBe(0);
  });
});
