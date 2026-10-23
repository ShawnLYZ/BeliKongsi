import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { verifyLogChain } from '@/server/modules/activity/log';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { createTestApp, type TestApp } from './helpers/app';
import {
  allocationOf,
  basketIdOf,
  consignmentFor,
  moveConsignment,
  opsApprovalOf,
  participationOf,
  payBasket,
  pickupOf,
  roundOf,
  setupKedaiKopi,
  supplierApprovalOf,
  supplierOrderOf,
  uploadPhoto,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const KAFE = seedId('shop', 'KAFE');
const WEEK = '2026-W45';
const DATE = '2026-11-10';

let app: TestApp;
let basketId: string;
let cmRound: string;
let cmOrder: string;
let claimApproval: string;

beforeAll(async () => {
  // The demo seed is the reference data plus the current week.
  app = await createTestApp({ seed: 'demo' });
});

afterAll(async () => {
  await app.close();
});

/** One week, one story: each stage builds on the one before. */
describe('A whole week through the API (story 181)', () => {
  it('1. Ah Seng sets up from the sample order', async () => {
    await setupKedaiKopi(app);
    const basket = await app.prisma.weeklyBasket.findFirst({
      where: { shopId: KEDAI, basketWeek: WEEK },
    });
    expect(basket).not.toBeNull();
    basketId = basket!.id;
    expect(basketId).toBe((await basketIdOf('KEDAI_KOPI', WEEK))!);
  });

  it('2. the basket is drafted and Rahim adds 1 evaporated milk', async () => {
    const res = await (
      await app.as('rahim')
    ).post(`/api/baskets/${basketId}/lines`, { productId: seedId('product', 'EM'), quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ basketId, routedToNextWeek: false });
  });

  it('3. Ah Seng pays with DuitNow QR', async () => {
    const summary = await payBasket(app, 'ahSeng', basketId);
    expect(summary.status).toBe('succeeded');
    expect((await participationOf('KEDAI_KOPI', 'CM')).paidSen).toBe(98454);
  });

  it('4. the cut-off forms the rounds and refunds the price difference', async () => {
    const res = await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
    expect(res.status).toBe(200);
    cmRound = (await roundOf('CM', WEEK)).id;
    const diffs = await app.prisma.ledgerPosting.findMany({
      where: { roundId: cmRound, kind: 'refund_difference' },
    });
    expect(diffs.filter((r) => r.shopId === KEDAI).map((r) => r.amountSen)).toEqual([7344]);
    // Kafe's egg round did not reach its minimum, so its 10 trays are refunded in full.
    const dropped = await app.prisma.ledgerPosting.findMany({
      where: { kind: 'refund_dropped', shopId: KAFE, roundId: (await roundOf('EGG_B', WEEK)).id },
    });
    expect(dropped.map((r) => r.amountSen)).toEqual([12330]);
  });

  it('5. Nadia approves the CM order with the evidence in front of her', async () => {
    cmOrder = (await supplierOrderOf(cmRound)).id;
    const approvalId = await opsApprovalOf(cmOrder);
    const approval = await app.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approvalId },
    });
    expect(approval.evidence).toMatchObject({
      quantity: 105,
      orderCostSen: 1533000,
      shopCount: 9,
      moneyCheck: { passed: true },
    });
    const res = await (await app.as('nadia')).post(`/api/approvals/${approvalId}/approve`, {});
    expect(res.status).toBe(200);
    expect((await roundOf('CM', WEEK)).status).toBe('ordered');
  });

  it('6. Farid confirms with 7 Nov, then marks it dispatched', async () => {
    const farid = await app.as('farid');
    const confirmed = await farid.post(
      `/api/approvals/${await supplierApprovalOf(cmOrder)}/approve`,
      {
        expectedDispatchDate: '2026-11-07',
      },
    );
    expect(confirmed.status).toBe(200);
    const sent = await farid.post(`/api/supplier-orders/${cmOrder}/dispatched`);
    expect(sent.status).toBe(200);
  });

  it('7. Nadia hub-checks 105 good and the supplier is paid', async () => {
    const res = await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${cmOrder}/hub-check`, { goodUnits: 105, damagedUnits: 0 });
    expect(res.status).toBe(200);
    const payouts = await app.prisma.ledgerPosting.findMany({
      where: { supplierOrderId: cmOrder, kind: 'supplier_payout' },
    });
    expect(payouts.reduce((s, x) => s + x.amountSen, 0)).toBe(1533000);
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(0);
  });

  it('8. Ops completes the other rounds, then sends the Ipoh consignments', async () => {
    const nadia = await app.as('nadia');
    const res = await nadia.post('/api/demo/complete-other-rounds');
    expect(res.status).toBe(200);
    for (const hub of ['HUB_KV', 'HUB_JOHOR']) {
      const c = await consignmentFor({ hub, destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE });
      // The Johor Bahru one went with the other rounds; only the featured Klang Valley one waits.
      if (c.status === 'planned') await moveConsignment(app, c.id, 'dispatched');
      if (c.status !== 'arrived') await moveConsignment(app, c.id, 'arrived');
    }
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
  });

  it('9. Rahim collects with the code, then reports 1 damaged carton with a photo', async () => {
    const p = await pickupOf('KEDAI_KOPI', DATE);
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    const photo = await uploadPhoto(rahim, p.id);
    const cm = await allocationOf('KEDAI_KOPI', 'CM');
    const res = await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
      lines: [{ allocationId: cm.id, missing: 0, damaged: 1, photoIds: [photo] }],
    });
    expect(res.status).toBe(200);
    const claim = await app.prisma.claim.findUniqueOrThrow({ where: { id: res.body.claimId } });
    expect(claim).toMatchObject({ status: 'submitted', totalRefundSen: 15185 });
    claimApproval = claim.approvalRequestId!;
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('checked');
  });

  it('10. Nadia approves the claim and RM 151.85 comes back', async () => {
    const before = await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI });
    const res = await (await app.as('nadia')).post(`/api/approvals/${claimApproval}/approve`, {});
    expect(res.status).toBe(200);
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(
      before + 15185,
    );
    const refund = await app.prisma.ledgerPosting.findFirstOrThrow({
      where: { kind: 'refund_claim' },
    });
    expect(refund.amountSen).toBe(15185);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
  });

  it('11. every pickup closes, the books balance, the log chain holds and the round completes', async () => {
    // Whatever is still on the road (featured goods left planned, door runs left out for
    // delivery) is moved along by Nadia until it reaches its destination.
    const moving = await app.prisma.consignment.findMany({
      where: { status: { in: ['planned', 'dispatched', 'out_for_delivery'] } },
    });
    expect(moving.length).toBeGreaterThan(0);
    for (const c of moving) {
      const steps =
        c.destinationType === 'door'
          ? ['dispatched', 'out_for_delivery', 'delivered']
          : ['dispatched', 'arrived'];
      for (const step of steps.slice(steps.indexOf(c.status) + 1)) {
        await moveConsignment(app, c.id, step);
      }
    }
    // Gerai's and Kafe's staff collect their goods, then confirm "All received".
    for (const [shopKey, userKey] of [
      ['GERAI', 'kumar'],
      ['KAFE', 'danial'],
    ] as const) {
      const p = await pickupOf(shopKey, DATE);
      const client = await app.as(userKey);
      if (p.status === 'ready' || p.status === 'out_for_delivery') {
        expect((await client.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(
          200,
        );
      }
      const res = await client.post(`/api/pickups/${p.id}/delivery-check`, { allReceived: true });
      expect(res.status).toBe(200);
    }
    const open = await app.prisma.pickup.findMany({ where: { status: { not: 'closed' } } });
    expect(open).toEqual([]);
    expect((await roundOf('CM', WEEK)).status).toBe('completed');
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
    expect(await verifyLogChain(app.prisma)).toMatchObject({ valid: true });
  });
});
