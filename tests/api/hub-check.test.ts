import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PostingKind } from '@/generated/prisma/client';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { createTestApp, type TestApp } from './helpers/app';
import {
  countWhatsapp,
  lastWhatsapp,
  opsApprovalOf,
  order,
  participationOf,
  round,
  roundOf,
  supplierApprovalOf,
  supplierOrderOf,
  SUP_DRY,
  toFormed,
} from './helpers/scenarios';

const WEEK = '2026-W45';

let app: TestApp;
let cmRound: string;
let cmOrder: string;

/** Condensed milk: formed, approved by Ops, confirmed and dispatched by Farid. */
beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toFormed(app);
  cmRound = (await roundOf('CM', WEEK)).id;
  cmOrder = (await supplierOrderOf(cmRound)).id;
  await (await app.as('nadia')).post(`/api/approvals/${await opsApprovalOf(cmOrder)}/approve`, {});
  const farid = await app.as('farid');
  await farid.post(`/api/approvals/${await supplierApprovalOf(cmOrder)}/approve`, {
    expectedDispatchDate: '2026-11-07',
  });
  await farid.post(`/api/supplier-orders/${cmOrder}/dispatched`);
});

afterEach(async () => {
  await app.close();
});

const postingsOf = (kind: PostingKind) =>
  app.prisma.ledgerPosting.findMany({ where: { kind, roundId: cmRound } });
const sumSen = (rows: { amountSen: number }[]) => rows.reduce((s, r) => s + r.amountSen, 0);
const moneyOk = async () => expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
const hubCheck = () =>
  app.prisma.hubCheck.findUniqueOrThrow({ where: { supplierOrderId: cmOrder } });
/** This order's hub checks and allocations: the history week's are already there. */
const hubChecks = () => app.prisma.hubCheck.count({ where: { supplierOrderId: cmOrder } });
const allocations = async () => {
  const parts = await app.prisma.participation.findMany({
    where: { roundId: cmRound },
    select: { id: true },
  });
  return app.prisma.allocation.count({
    where: { participationId: { in: parts.map((p) => p.id) } },
  });
};
/** Farid's payouts for this order (the history week's orders were paid a week earlier). */
const payoutsOfOrder = async () =>
  (
    (await (await app.as('farid')).get(`/api/suppliers/${SUP_DRY}/payouts`)).body.items as {
      supplierOrderId: string;
      reference: string;
    }[]
  ).filter((i) => i.supplierOrderId === cmOrder);

describe('The hub check', () => {
  it('pays the supplier RM 15,330.00 for 105 good cartons (stories 108, 123)', async () => {
    const nadia = await app.as('nadia');
    const res = await nadia.post(`/api/supplier-orders/${cmOrder}/hub-check`, {
      goodUnits: 105,
      damagedUnits: 0,
    });
    expect(res.status).toBe(200);
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(0);
    expect((await round(cmRound)).status).toBe('at_hub');
    expect((await order(cmOrder)).status).toBe('settled');
    expect(await lastWhatsapp('farid', 'supplier.payout')).toBe(
      'Payment released: RM 15,330.00 for 105 cartons (simulated).',
    );
    expect(sumSen(await postingsOf('settlement_supplier'))).toBe(1533000);
    expect(sumSen(await postingsOf('supplier_payout'))).toBe(1533000);
    expect(await postingsOf('refund_shortfall')).toHaveLength(0);
    expect(await countWhatsapp('ahSeng', 'owner.shortfall')).toBe(0);
    await moneyOk();
  });

  it('shows the supplier the simulated payout (story 108)', async () => {
    await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${cmOrder}/hub-check`, { goodUnits: 105, damagedUnits: 0 });
    const res = await (await app.as('farid')).get(`/api/suppliers/${SUP_DRY}/payouts`);
    expect(res.status).toBe(200);
    const items = await payoutsOfOrder();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      supplierOrderId: cmOrder,
      amountSen: 1533000,
      goodUnits: 105,
      simulated: true,
    });
    expect(items[0]!.reference).toMatch(/^SIM-OUT-/);
  });

  it('previews a 5-carton shortfall falling on the last joiner (story 122)', async () => {
    const p = (
      await (
        await app.as('nadia')
      ).post(`/api/supplier-orders/${cmOrder}/hub-check?preview=true`, {
        goodUnits: 100,
        damagedUnits: 5,
      })
    ).body;
    expect(p.allocations.at(-1)).toMatchObject({
      shopName: 'Kedai Kopi Contoh',
      allocated: 1,
      missing: 5,
      refundSen: 75925,
    });
    expect(p.supplierPayableSen).toBe(1460000);
    expect(p.shortfallRefundSen).toBe(75925);
    expect(await hubChecks()).toBe(0); // preview writes nothing
    expect(await allocations()).toBe(0);
    expect((await order(cmOrder)).status).toBe('dispatched');
  });

  it('lets only Ops preview or record a hub check', async () => {
    const body = { goodUnits: 105, damagedUnits: 0 };
    const farid = await app.as('farid');
    expect((await farid.post(`/api/supplier-orders/${cmOrder}/hub-check`, body)).status).toBe(403);
    expect(
      (await farid.post(`/api/supplier-orders/${cmOrder}/hub-check?preview=true`, body)).status,
    ).toBe(403);
    expect((await order(cmOrder)).status).toBe('dispatched');
  });

  it('rejects counts that are negative or not whole numbers', async () => {
    const nadia = await app.as('nadia');
    const url = `/api/supplier-orders/${cmOrder}/hub-check`;
    expect((await nadia.post(url, { goodUnits: -1, damagedUnits: 0 })).status).toBe(400);
    expect((await nadia.post(url, { goodUnits: 1.5, damagedUnits: 0 })).status).toBe(400);
    expect(
      (await nadia.post(`${url}?preview=true`, { goodUnits: 5, damagedUnits: -2 })).status,
    ).toBe(400);
    expect(await hubChecks()).toBe(0);
  });

  it('refunds the shortfall and tells the owner why (stories 174–176)', async () => {
    await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${cmOrder}/hub-check`, { goodUnits: 100, damagedUnits: 5 });
    expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({
      status: 'allocated',
      finalAllInSen: 15185,
    });
    expect(await lastWhatsapp('ahSeng', 'owner.shortfall')).toBe(
      'The supplier delivered short. 5 cartons of condensed milk refunded: RM 759.25.',
    );
    expect(sumSen(await postingsOf('refund_shortfall'))).toBe(75925);
    expect(sumSen(await postingsOf('settlement_supplier'))).toBe(1460000);
    expect(sumSen(await postingsOf('supplier_payout'))).toBe(1460000);
    expect(await lastWhatsapp('farid', 'supplier.payout')).toBe(
      'Payment released: RM 14,600.00 for 100 cartons (simulated).',
    );
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(0);
    const hc = await hubCheck();
    expect(hc).toMatchObject({
      goodUnits: 100,
      damagedUnits: 5,
      receivedCounted: 100,
      shortfallUnits: 5,
      excessUnits: 0,
      payoutSen: 1460000,
    });
    expect(hc.payoutReference).toMatch(/^SIM-OUT-/);
    await moneyOk();
  });

  it('settles fees and logistics from the allocated units only', async () => {
    await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${cmOrder}/hub-check`, { goodUnits: 100, damagedUnits: 5 });
    const parts = await app.prisma.participation.findMany({
      where: { roundId: cmRound, status: 'allocated' },
    });
    const allocs = await app.prisma.allocation.findMany({
      where: { participationId: { in: parts.map((p) => p.id) } },
    });
    const allocatedOf = (id: string) =>
      allocs.find((a) => a.participationId === id)?.allocated ?? 0;
    const fee = parts.reduce((s, p) => s + allocatedOf(p.id) * (p.finalFeeSen ?? 0), 0);
    const logistics = parts.reduce((s, p) => s + allocatedOf(p.id) * p.unitShippingSen, 0);
    expect(fee).toBeGreaterThan(0);
    expect(sumSen(await postingsOf('settlement_fee'))).toBe(fee);
    expect(sumSen(await postingsOf('settlement_logistics'))).toBe(logistics);
  });

  it('caps and flags more units than ordered', async () => {
    const res = await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${cmOrder}/hub-check`, { goodUnits: 110, damagedUnits: 0 });
    expect(res.status).toBe(200);
    expect(await hubCheck()).toMatchObject({
      goodUnits: 110,
      receivedCounted: 105,
      excessUnits: 5,
      shortfallUnits: 0,
      payoutSen: 1533000,
    });
    expect(sumSen(await postingsOf('supplier_payout'))).toBe(1533000);
    expect(await postingsOf('refund_shortfall')).toHaveLength(0);
    expect(await lastWhatsapp('farid', 'supplier.payout')).toBe(
      'Payment released: RM 15,330.00 for 105 cartons (simulated).',
    );
    const payouts = await (await app.as('farid')).get(`/api/suppliers/${SUP_DRY}/payouts`);
    expect(payouts.body.items[0]).toMatchObject({ goodUnits: 105, amountSen: 1533000 });
    await moneyOk();
  });

  it('refunds everyone and pays nothing when no good units arrive', async () => {
    const kept = await app.prisma.participation.findMany({
      where: { roundId: cmRound, status: 'kept' },
    });
    const heldSen = kept.reduce((s, p) => s + (p.finalAllInSen ?? 0) * p.quantity, 0);
    const payoutNotices = await countWhatsapp('farid', 'supplier.payout');
    const res = await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${cmOrder}/hub-check`, { goodUnits: 0, damagedUnits: 105 });
    expect(res.status).toBe(200);
    const after = await app.prisma.participation.findMany({
      where: { id: { in: kept.map((k) => k.id) } },
    });
    expect(after.every((p) => p.status === 'shorted')).toBe(true);
    expect(sumSen(await postingsOf('refund_shortfall'))).toBe(heldSen);
    expect(await postingsOf('settlement_supplier')).toHaveLength(0);
    expect(await postingsOf('settlement_fee')).toHaveLength(0);
    expect(await postingsOf('settlement_logistics')).toHaveLength(0);
    expect(await postingsOf('supplier_payout')).toHaveLength(0);
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(0);
    const hc = await hubCheck();
    expect(hc).toMatchObject({ payoutSen: 0, receivedCounted: 0, shortfallUnits: 105 });
    expect(hc.payoutReference).toMatch(/^SIM-OUT-/);
    expect(await countWhatsapp('farid', 'supplier.payout')).toBe(payoutNotices);
    expect((await order(cmOrder)).status).toBe('settled');
    expect(await payoutsOfOrder()).toEqual([]);
    await moneyOk();
  });

  it('records for real when the same idempotency key was used for the preview', async () => {
    const nadia = await app.as('nadia');
    const url = `/api/supplier-orders/${cmOrder}/hub-check`;
    const headers = { 'idempotency-key': 'hub-check-1' };
    const body = { goodUnits: 100, damagedUnits: 5 };
    expect((await nadia.post(`${url}?preview=true`, body, headers)).status).toBe(200);
    expect(await hubChecks()).toBe(0);
    expect((await nadia.post(url, body, headers)).status).toBe(200);
    expect(await hubChecks()).toBe(1);
    expect((await order(cmOrder)).status).toBe('settled');
  });

  it('refuses a second hub check', async () => {
    const nadia = await app.as('nadia');
    const url = `/api/supplier-orders/${cmOrder}/hub-check`;
    expect((await nadia.post(url, { goodUnits: 100, damagedUnits: 5 })).status).toBe(200);
    const refunds = (await postingsOf('refund_shortfall')).length;
    const second = await nadia.post(url, { goodUnits: 100, damagedUnits: 5 });
    expect(second.status).toBe(409);
    expect(await postingsOf('supplier_payout')).toHaveLength(1);
    expect(await postingsOf('refund_shortfall')).toHaveLength(refunds);
    expect(await hubChecks()).toBe(1);
    await moneyOk();
  });

  it('refuses a hub check on an order that has not been dispatched', async () => {
    const eggOrder = (await supplierOrderOf((await roundOf('EGG_A', WEEK)).id)).id;
    const res = await (
      await app.as('nadia')
    ).post(`/api/supplier-orders/${eggOrder}/hub-check`, { goodUnits: 1, damagedUnits: 0 });
    expect(res.status).toBe(409);
  });
});
