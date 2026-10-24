import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { createTestApp, type TestApp } from './helpers/app';
import {
  allocationOf,
  consignmentFor,
  countWhatsapp,
  feeChargeOf,
  lastWhatsapp,
  moveConsignment,
  opsApprovalOf,
  order,
  participationOf,
  pickupOf,
  roundOf,
  supplierApprovalOf,
  supplierOrderOf,
  toFormed,
  toHubChecked,
} from './helpers/scenarios';

const KEDAI_KOPI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const DATE = '2026-11-10';
const KEDAI_ROUNDS = ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];
const GERAI_DOOR = { hub: 'HUB_KV', destinationKey: `door:${GERAI}`, deliveryDate: DATE };
const FINAL = 15185;
// 72 hours after Tue 10 Nov 10:00 Malaysia time.
const T_71H59 = '2026-11-13T01:59:00Z';
const T_72H = '2026-11-13T02:00:00Z';

let app: TestApp;

afterEach(async () => {
  await app.close();
});

/** Sets the time the code sees, whatever offset the demo's skip to the cut-off left behind. */
async function at(iso: string): Promise<void> {
  const { clockOffsetMs } = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
  app.clock.set(new Date(Date.parse(iso) - Number(clockOffsetMs)).toISOString());
}

const moneyOk = async () => expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
const balance = (shopId: string) => balanceOf(app.prisma, { kind: 'shop_balance', shopId });
const cancelPath = (id: string) => `/api/participations/${id}/late-cancel`;

describe('Cancelling a late item before the hub check', () => {
  let cmRound: string;
  let cmOrder: string;
  let cmPart: string;

  /** Condensed milk: formed, approved by Ops, confirmed and dispatched, but not hub-checked. */
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toFormed(app);
    cmRound = (await roundOf('CM', '2026-W45')).id;
    cmOrder = (await supplierOrderOf(cmRound)).id;
    await (
      await app.as('nadia')
    ).post(`/api/approvals/${await opsApprovalOf(cmOrder)}/approve`, {});
    const farid = await app.as('farid');
    await farid.post(`/api/approvals/${await supplierApprovalOf(cmOrder)}/approve`, {
      expectedDispatchDate: '2026-11-07',
    });
    await farid.post(`/api/supplier-orders/${cmOrder}/dispatched`);
    cmPart = (await participationOf('KEDAI_KOPI', 'CM')).id;
  });

  it('refuses at 71 h 59 min and allows at exactly 72 h', async () => {
    const ah = await app.as('ahSeng');
    await at(T_71H59);
    const early = await ah.post(cancelPath(cmPart));
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('TOO_EARLY');
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('kept');
    await at(T_72H);
    expect((await ah.post(cancelPath(cmPart))).status).toBe(200);
  });

  it('refunds from the round hold and lowers the accepted quantity', async () => {
    const ah = await app.as('ahSeng');
    await at(T_72H);
    const before = await balance(KEDAI_KOPI);
    const holdBefore = await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound });
    expect((await order(cmOrder)).acceptedQuantity).toBe(105);
    const res = await ah.post(cancelPath(cmPart));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      refundSen: 6 * FINAL,
      deliveryFeeRefundSen: 0,
      source: 'round_hold',
    });
    expect((await order(cmOrder)).acceptedQuantity).toBe(99);
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('cancelled_late');
    expect(await balance(KEDAI_KOPI)).toBe(before + 6 * FINAL);
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(
      holdBefore - 6 * FINAL,
    );
    expect(
      await app.prisma.ledgerPosting.count({
        where: { kind: 'refund_late', participationId: cmPart, amountSen: 6 * FINAL },
      }),
    ).toBe(1);
    await moneyOk();
  });

  it('flags the cancelled units at a later hub check and does not pay for them', async () => {
    await at(T_72H);
    await (await app.as('ahSeng')).post(cancelPath(cmPart));
    const checked = await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${cmOrder}/hub-check`, { goodUnits: 105, damagedUnits: 0 });
    expect(checked.status).toBe(200);
    expect(
      await app.prisma.hubCheck.findUniqueOrThrow({ where: { supplierOrderId: cmOrder } }),
    ).toMatchObject({
      receivedCounted: 99,
      excessUnits: 6,
      shortfallUnits: 0,
      payoutSen: 99 * 14600,
    });
    expect(await allocationCount(cmPart)).toBe(0);
    await moneyOk();
  });

  it('tells the owner, with the amount, and never the staff', async () => {
    await at(T_72H);
    await (await app.as('ahSeng')).post(cancelPath(cmPart));
    expect(await lastWhatsapp('ahSeng', 'delivery.late_cancelled')).toBe(
      'Cancelled a late item: 6 cartons of condensed milk. RM 911.10 is back in your balance.',
    );
    expect(await countWhatsapp('rahim', 'delivery.late_cancelled')).toBe(0);
  });

  it('replays the first answer for the same Idempotency-Key and refunds once', async () => {
    const ah = await app.as('ahSeng');
    await at(T_72H);
    const key = { 'Idempotency-Key': 'late-cancel-1' };
    const first = await ah.post(cancelPath(cmPart), undefined, key);
    const before = await balance(KEDAI_KOPI);
    const again = await ah.post(cancelPath(cmPart), undefined, key);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await balance(KEDAI_KOPI)).toBe(before);
    expect(await countWhatsapp('ahSeng', 'delivery.late_cancelled')).toBe(1);
  });

  it('refuses an item that is already cancelled (409)', async () => {
    const ah = await app.as('ahSeng');
    await at(T_72H);
    await ah.post(cancelPath(cmPart));
    const again = await ah.post(cancelPath(cmPart), undefined, { 'Idempotency-Key': 'second' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('NOT_CANCELLABLE');
  });

  it('refuses goods that are not late (409)', async () => {
    // Before the expected ready time (Tue 10 Nov, 10:00) nothing is late, however long ago.
    await at('2026-11-10T01:59:00Z');
    const res = await (await app.as('ahSeng')).post(cancelPath(cmPart));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_CANCELLABLE');
  });

  it('refuses staff (403) and another shop (404)', async () => {
    await at(T_72H);
    expect((await (await app.as('rahim')).post(cancelPath(cmPart))).status).toBe(403);
    expect((await (await app.as('siti')).post(cancelPath(cmPart))).status).toBe(404);
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('kept');
  });
});

/** Live allocations of a participation (0 or 1): a cancelled one is not live. */
const allocationCount = (participationId: string) =>
  app.prisma.allocation.count({ where: { participationId } });

describe('Cancelling a late item after the hub check', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
  });

  it('refunds from claims expense', async () => {
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const claimsBefore = await balanceOf(app.prisma, { kind: 'claims_expense' });
    const before = await balance(KEDAI_KOPI);
    await at(T_72H);
    const res = await (await app.as('ahSeng')).post(cancelPath(part.id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      refundSen: 6 * FINAL,
      deliveryFeeRefundSen: 0,
      source: 'claims_expense',
    });
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('cancelled_late');
    expect((await allocationOf('KEDAI_KOPI', 'CM')).cancelledLateAt).not.toBeNull();
    expect(await balance(KEDAI_KOPI)).toBe(before + 6 * FINAL);
    expect(await balanceOf(app.prisma, { kind: 'claims_expense' })).toBe(claimsBefore - 6 * FINAL);
    await moneyOk();
  });

  it('shows the refund on My Kongsi, with no savings, once a line is cancelled late', async () => {
    const part = await participationOf('KEDAI_KOPI', 'CM');
    await at(T_72H);
    const ah = await app.as('ahSeng');
    expect((await ah.post(cancelPath(part.id))).status).toBe(200);
    const res = await ah.get(`/api/shops/${KEDAI_KOPI}/participations?status=history`);
    expect(res.status).toBe(200);
    const line = res.body.items.find(
      (i: { participationId: string }) => i.participationId === part.id,
    );
    // Everything paid comes back: the close's price difference, then the late refund.
    expect(line).toMatchObject({ status: 'cancelled_late', savings: null });
    expect(line.refundSen).toBe(line.paidSen);
    expect(line.refundSen).toBe(part.paidSen);
  });

  it('counts a late refund in the month and no fees or savings on the cancelled line', async () => {
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const ah = await app.as('ahSeng');
    await at(T_72H);
    const month = async () =>
      (await ah.get(`/api/shops/${KEDAI_KOPI}/savings?month=2026-11`)).body as {
        refundsSen: number;
        feesPaidSen: number;
        items: { participationId: string }[];
      };
    const before = await month();
    expect(before.items.map((i) => i.participationId)).toContain(part.id);
    expect((await ah.post(cancelPath(part.id))).status).toBe(200);
    const after = await month();
    expect(after.refundsSen).toBe(before.refundsSen + 6 * FINAL);
    expect(after.feesPaidSen).toBe(before.feesPaidSen - 6 * part.finalFeeSen!);
    expect(after.items.map((i) => i.participationId)).not.toContain(part.id);
  });

  it('keeps the delivery fee once the door consignment has been dispatched', async () => {
    await moveConsignment(app, (await consignmentFor(GERAI_DOOR)).id, 'dispatched');
    const part = await participationOf('GERAI', 'CM');
    const alloc = await allocationOf('GERAI', 'CM');
    await at(T_72H);
    const res = await (await app.as('siti')).post(cancelPath(part.id));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      refundSen: alloc.allocated * part.finalAllInSen!,
      deliveryFeeRefundSen: 0,
      source: 'claims_expense',
    });
    expect(await feeChargeOf('GERAI', DATE)).toMatchObject({
      status: 'passed_to_partner',
      amountSen: 1200,
    });
    await moneyOk();
  });

  it('measures the 72 hours from the original time, not from a new date', async () => {
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const c = await consignmentFor({
      hub: 'HUB_KV',
      destinationKey: `pp:${seedId('pickup_point', 'PP_IPOH')}`,
      deliveryDate: DATE,
    });
    await at('2026-11-11T04:00:00Z');
    await (
      await app.as('nadia')
    ).post(`/api/consignments/${c.id}/delay`, { newDate: '2026-11-20', reason: 'Truck breakdown' });
    const ah = await app.as('ahSeng');
    await at(T_71H59);
    expect((await ah.post(cancelPath(part.id))).body.code).toBe('TOO_EARLY');
    await at(T_72H);
    expect((await ah.post(cancelPath(part.id))).status).toBe(200);
  });

  it('refuses goods that have already been collected (409)', async () => {
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    await app.prisma.pickup.update({ where: { id: pickup.id }, data: { status: 'collected' } });
    await at(T_72H);
    const res = await (await app.as('ahSeng')).post(cancelPath(part.id));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_CANCELLABLE');
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('allocated');
    await moneyOk();
  });
});

/** Dispatches and lands every pickup-point consignment of the live allocations of a pickup. */
async function arriveLiveGoods(pickupId: string): Promise<void> {
  const live = await app.prisma.allocation.findMany({
    where: { pickupId, cancelledLateAt: null, consignmentId: { not: null } },
    select: { consignmentId: true },
  });
  for (const id of new Set(live.map((a) => a.consignmentId!))) {
    await moveConsignment(app, id, 'dispatched');
    await moveConsignment(app, id, 'arrived');
  }
}

describe('Cancelling a late item when the group has other rounds', () => {
  it('closes the pickup only when its last item is cancelled', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    await at(T_72H);
    const ah = await app.as('ahSeng');
    for (const [i, key] of KEDAI_ROUNDS.entries()) {
      const part = await participationOf('KEDAI_KOPI', key);
      expect((await ah.post(cancelPath(part.id))).status).toBe(200);
      const status = (await pickupOf('KEDAI_KOPI', DATE)).status;
      expect(status).toBe(i === KEDAI_ROUNDS.length - 1 ? 'closed' : 'waiting');
    }
    await moneyOk();
  });

  it('leaves the pickup waiting while another round is still to be hub-checked', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    await at(T_72H);
    expect((await (await app.as('ahSeng')).post(cancelPath(part.id))).status).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
    // The other rounds' goods then join the same pickup (approvals need the earlier clock).
    await at('2026-11-06T04:00:00Z');
    await toHubChecked(
      app,
      KEDAI_ROUNDS.filter((k) => k !== 'CM'),
    );
    expect((await pickupOf('KEDAI_KOPI', DATE)).id).toBe(pickup.id);
    await arriveLiveGoods(pickup.id);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
    await moneyOk();
  });

  it('stays open and becomes ready when other live allocations remain', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    await at(T_72H);
    expect((await (await app.as('ahSeng')).post(cancelPath(part.id))).status).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
    await arriveLiveGoods(pickup.id);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
    await moneyOk();
  });

  it('completes the round of the cancelled item when its pickup closes', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    await at(T_72H);
    await (await app.as('ahSeng')).post(cancelPath(part.id));
    await arriveLiveGoods(pickup.id);
    // Other shops' pickups of these rounds are done, so this pickup is the last one open.
    const ofRounds = await app.prisma.allocation.findMany({
      where: { pickupId: { not: pickup.id } },
    });
    await app.prisma.pickup.updateMany({
      where: { id: { in: ofRounds.map((a) => a.pickupId!) } },
      data: { status: 'closed' },
    });
    const rahim = await app.as('rahim');
    expect(
      (await rahim.post(`/api/pickups/${pickup.id}/collect`, { code: pickup.code })).status,
    ).toBe(200);
    const res = await rahim.post(`/api/pickups/${pickup.id}/delivery-check`, { allReceived: true });
    expect(res.status).toBe(200);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('cancelled_late');
    expect((await participationOf('KEDAI_KOPI', 'OIL')).status).toBe('closed');
    expect((await roundOf('CM', '2026-W45')).status).toBe('completed');
    expect((await roundOf('OIL', '2026-W45')).status).toBe('completed');
    await moneyOk();
  });
});

describe('Cancelling a late item: the rest of the rules', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
  });

  it('gives the delivery fee back with the last door item, before anything is dispatched', async () => {
    await toFormed(app);
    const lines = await app.prisma.participation.findMany({
      where: { shopId: GERAI, status: 'kept', destinationType: 'door', deliveryDate: DATE },
      orderBy: { id: 'asc' },
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(await feeChargeOf('GERAI', DATE)).toMatchObject({ status: 'held', amountSen: 1200 });
    await at(T_72H);
    const siti = await app.as('siti');
    const before = await balance(GERAI);
    let refunded = 0;
    let feeBack = 0;
    for (const [i, line] of lines.entries()) {
      const res = await siti.post(cancelPath(line.id));
      expect(res.status).toBe(200);
      const last = i === lines.length - 1;
      expect(res.body.deliveryFeeRefundSen).toBe(last ? 1200 : 0);
      refunded += res.body.refundSen;
      feeBack += res.body.deliveryFeeRefundSen;
    }
    expect(refunded).toBe(lines.reduce((sum, l) => sum + l.finalAllInSen! * l.quantity, 0));
    expect(await balance(GERAI)).toBe(before + refunded + feeBack);
    expect(await feeChargeOf('GERAI', DATE)).toMatchObject({ status: 'refunded' });
    await moneyOk();
  });

  it('refuses goods that are past their time but already ready, when nothing was recorded (409)', async () => {
    await toHubChecked(app, ['CM']);
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    await app.prisma.pickup.update({ where: { id: pickup.id }, data: { status: 'ready' } });
    expect(await app.prisma.lateDelivery.count({ where: { shopId: KEDAI_KOPI } })).toBe(0);
    await at(T_72H);
    const res = await (await app.as('ahSeng')).post(cancelPath(part.id));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_CANCELLABLE');
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('allocated');
  });
});

describe('Cancelling late leaves no consignment stuck at the pickup point', () => {
  const IPOH = `pp:${seedId('pickup_point', 'PP_IPOH')}`;
  const KV_IPOH = { hub: 'HUB_KV', destinationKey: IPOH, deliveryDate: DATE };
  const JOHOR_IPOH = { ...KV_IPOH, hub: 'HUB_JOHOR' };

  /** Every other shop's pickup on these consignments is done, so only Kedai Kopi's goods count. */
  async function closeOtherPickups(): Promise<void> {
    const kedai = await pickupOf('KEDAI_KOPI', DATE);
    await app.prisma.pickup.updateMany({
      where: { id: { not: kedai.id } },
      data: { status: 'closed' },
    });
  }

  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    const eggs = await participationOf('KEDAI_KOPI', 'EGG_A');
    const { expectedReadyAt } = await roundOf('EGG_A', '2026-W45');
    // The group was found late before anything arrived.
    await app.prisma.lateDelivery.create({
      data: {
        shopId: KEDAI_KOPI,
        destinationKey: pickup.destinationKey,
        deliveryDate: DATE,
        originalExpectedAt: expectedReadyAt,
        detectedAt: expectedReadyAt,
      },
    });
    expect(eggs.status).toBe('allocated');
    await closeOtherPickups();
    await at(T_72H);
  });

  it('completes an arrived consignment once its last goods are cancelled late', async () => {
    const johor = await consignmentFor(JOHOR_IPOH);
    await moveConsignment(app, johor.id, 'dispatched');
    await moveConsignment(app, johor.id, 'arrived');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('partly_ready');
    const eggs = await participationOf('KEDAI_KOPI', 'EGG_A');
    expect((await (await app.as('ahSeng')).post(cancelPath(eggs.id))).status).toBe(200);
    expect((await consignmentFor(JOHOR_IPOH)).status).toBe('completed');
    await moneyOk();
  });

  it('completes a consignment on arrival when all its goods were cancelled late first', async () => {
    const ah = await app.as('ahSeng');
    for (const key of ['CM', 'OIL', 'COFFEE', 'CUPS']) {
      const part = await participationOf('KEDAI_KOPI', key);
      expect((await ah.post(cancelPath(part.id))).status).toBe(200);
    }
    const kv = await consignmentFor(KV_IPOH);
    await moveConsignment(app, kv.id, 'dispatched');
    await moveConsignment(app, kv.id, 'arrived');
    expect((await consignmentFor(KV_IPOH)).status).toBe('completed');
    // The eggs still on their way keep the pickup waiting.
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
    await moneyOk();
  });

  it('completes the arrived consignment when the cancelled rest settles a partly collected pickup', async () => {
    const johor = await consignmentFor(JOHOR_IPOH);
    await moveConsignment(app, johor.id, 'dispatched');
    await moveConsignment(app, johor.id, 'arrived');
    const p = await pickupOf('KEDAI_KOPI', DATE);
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    const kv = await consignmentFor(KV_IPOH);
    await moveConsignment(app, kv.id, 'dispatched');
    await moveConsignment(app, kv.id, 'arrived');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
    // The owner cancels everything that arrived second: the pickup settles as collected.
    const ah = await app.as('ahSeng');
    for (const key of ['CM', 'OIL', 'COFFEE', 'CUPS']) {
      const part = await participationOf('KEDAI_KOPI', key);
      expect((await ah.post(cancelPath(part.id))).status).toBe(200);
    }
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('collected');
    expect((await consignmentFor(KV_IPOH)).status).toBe('completed');
    await moneyOk();
  });
});
