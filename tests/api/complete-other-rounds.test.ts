import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { mytDate } from '@/lib/time';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { getDeps } from '@/server/platform/deps';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import {
  consignmentFor,
  moveConsignment,
  opsApprovalOf,
  pickupOf,
  roundOf,
  supplierApprovalOf,
  supplierOrderOf,
  toHubChecked,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const WEEK = '2026-W45';
const DATE = '2026-11-10';

let app: TestApp;
let nadia: Client;

/** The demo has paid and skipped to the cut-off; Ops took condensed milk (featured) to the hub. */
beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toHubChecked(app, ['CM']);
  nadia = await app.as('nadia');
});

afterEach(async () => {
  await app.close();
});

const lastSeq = async () =>
  (await getDeps().prisma.activityChainHead.findUniqueOrThrow({ where: { id: 1 } })).lastSeq;

describe('Complete other rounds', () => {
  it('fast-forwards every non-featured round and leaves condensed milk to Ops (story 165)', async () => {
    const res = await nadia.post('/api/demo/complete-other-rounds');
    expect(res.status).toBe(200);
    expect(res.body.rounds).toBeGreaterThan(0);
    expect(res.body.consignmentsMoved).toBeGreaterThan(0);

    const oil = await roundOf('OIL', WEEK);
    expect(oil.status).toBe('at_hub');
    expect((await supplierOrderOf(oil.id)).status).toBe('settled');
    const formedLeft = await getDeps().prisma.round.count({ where: { status: 'formed' } });
    expect(formedLeft).toBe(0);

    const kvIpoh = await consignmentFor({
      hub: 'HUB_KV',
      destinationKey: `pp:${PP_IPOH}`,
      deliveryDate: DATE,
    });
    expect(kvIpoh.status).toBe('planned');
    const view = (await nadia.get('/api/ops/consignments')).body.items.find(
      (c: { consignmentId: string }) => c.consignmentId === kvIpoh.id,
    );
    expect(view).toMatchObject({ status: 'planned', containsFeaturedRound: true });
    // The Johor eggs are there and can be collected on their own (P1-8).
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('partly_ready');

    // No consignment without featured goods is left planned.
    const planned = (await nadia.get('/api/ops/consignments')).body.items.filter(
      (c: { status: string }) => c.status === 'planned',
    );
    expect(planned.every((c: { containsFeaturedRound: boolean }) => c.containsFeaturedRound)).toBe(
      true,
    );

    await moveConsignment(app, kvIpoh.id, 'dispatched');
    await moveConsignment(app, kvIpoh.id, 'arrived');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
    expect((await runMoneyChecks(getDeps().prisma)).allPassed).toBe(true);
  });

  it('marks every step as demo simulation', async () => {
    const before = await lastSeq();
    const res = await nadia.post('/api/demo/complete-other-rounds');
    expect(res.status).toBe(200);
    const entries = await getDeps().prisma.activityLogEntry.findMany({
      where: { seq: { gt: before } },
      orderBy: { seq: 'asc' },
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.actorType).toBe('system');
    // Background shops' own collections keep their reason; every other step is the demo's.
    const own = entries.filter((e) => e.reason !== 'background shop simulation');
    for (const e of own)
      expect({ action: e.action, reason: e.reason }).toMatchObject({ reason: 'Demo simulation' });
    const actions = new Set(own.map((e) => e.action));
    for (const a of [
      'supplier_order.approved',
      'supplier_order.confirmed',
      'supplier_order.dispatched',
      'hub.check_recorded',
      'fulfilment.consignment_status_changed',
    ]) {
      expect(actions).toContain(a);
    }
    const summary = entries.filter((e) => e.action === 'demo.complete_other_rounds');
    expect(summary).toHaveLength(1);
    expect(summary[0]!.after).toEqual(res.body);

    const oilOrder = await supplierOrderOf((await roundOf('OIL', WEEK)).id);
    const approvals = await getDeps().prisma.approvalRequest.findMany({
      where: { subjectId: oilOrder.id },
    });
    expect(approvals.map((a) => a.type).sort()).toEqual([
      'supplier_confirmation',
      'supplier_order',
    ]);
    for (const a of approvals) {
      expect(a).toMatchObject({ status: 'approved', decidedByUserId: null });
      expect(a.decidedAt).not.toBeNull();
    }
    expect(oilOrder.expectedDispatchDate).toBe(oilOrder.requiredDispatchDate);
  });

  it('finishes rounds already past Ops approval, even after their required dispatch date', async () => {
    const farid = await app.as('farid');
    // Oil: Ops approved it from the inbox; it waits for the supplier.
    const oilOrder = await supplierOrderOf((await roundOf('OIL', WEEK)).id);
    expect(
      (await nadia.post(`/api/approvals/${await opsApprovalOf(oilOrder.id)}/approve`, {})).status,
    ).toBe(200);
    expect((await roundOf('OIL', WEEK)).status).toBe('ordered');
    // Flour: confirmed by the supplier, not dispatched yet.
    const flourOrder = await supplierOrderOf((await roundOf('FLOUR', WEEK)).id);
    await nadia.post(`/api/approvals/${await opsApprovalOf(flourOrder.id)}/approve`, {});
    await farid.post(`/api/approvals/${await supplierApprovalOf(flourOrder.id)}/approve`, {
      expectedDispatchDate: flourOrder.requiredDispatchDate,
    });
    expect((await roundOf('FLOUR', WEEK)).status).toBe('confirmed');
    // Coffee: dispatched, waiting for the hub check.
    const coffeeOrder = await supplierOrderOf((await roundOf('COFFEE', WEEK)).id);
    await nadia.post(`/api/approvals/${await opsApprovalOf(coffeeOrder.id)}/approve`, {});
    await farid.post(`/api/approvals/${await supplierApprovalOf(coffeeOrder.id)}/approve`, {
      expectedDispatchDate: coffeeOrder.requiredDispatchDate,
    });
    expect((await farid.post(`/api/supplier-orders/${coffeeOrder.id}/dispatched`)).status).toBe(
      200,
    );
    expect((await roundOf('COFFEE', WEEK)).status).toBe('dispatched');

    // The presenter comes back the day after Oil's required dispatch date (demo time).
    const late = new Date(`${oilOrder.requiredDispatchDate}T04:00:00Z`);
    late.setUTCDate(late.getUTCDate() + 1);
    const { clockOffsetMs } = await getDeps().prisma.demoSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    app.clock.set(new Date(late.getTime() - Number(clockOffsetMs)).toISOString());

    const res = await nadia.post('/api/demo/complete-other-rounds');
    expect(res.status).toBe(200);
    for (const key of ['OIL', 'FLOUR', 'COFFEE']) {
      expect({ key, status: (await roundOf(key, WEEK)).status }).toEqual({
        key,
        status: 'at_hub',
      });
    }
    expect((await supplierOrderOf(oilOrder.roundId)).expectedDispatchDate).toBe(mytDate(late));
    const unfinished = await getDeps().prisma.round.count({
      where: { status: { in: ['formed', 'ordered', 'confirmed', 'dispatched'] } },
    });
    expect(unfinished).toBe(0);
    expect((await runMoneyChecks(getDeps().prisma)).allPassed).toBe(true);
  });

  it('does nothing the second time', async () => {
    await nadia.post('/api/demo/complete-other-rounds');
    const before = await lastSeq();
    const again = await nadia.post('/api/demo/complete-other-rounds');
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ rounds: 0, consignmentsMoved: 0 });
    expect(await lastSeq()).toBe(before);
  });

  it('needs demo mode', async () => {
    await app.adminQuery('update demo_settings set demo_mode = false');
    const res = await nadia.post('/api/demo/complete-other-rounds');
    expect(res.status).toBe(404);
    expect(res.body.error?.code ?? res.body.code).toBe('DEMO_OFF');
    expect((await roundOf('OIL', WEEK)).status).toBe('formed');
  });
});
