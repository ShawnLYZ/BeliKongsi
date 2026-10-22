import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { createTestApp, type TestApp } from './helpers/app';
import {
  basketIdOf,
  lastWhatsapp,
  payBasket,
  roundOf,
  setupKedaiKopi,
  supplierOrderOf,
} from './helpers/scenarios';

const WEEK = '2026-W45';
const CUTOFF = '2026-11-05T12:00:00Z';

let app: TestApp;
let cmRound: string;

beforeAll(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  const basketId = (await basketIdOf('KEDAI_KOPI', WEEK))!;
  await payBasket(app, 'ahSeng', basketId);
  cmRound = (await roundOf('CM', WEEK)).id;
  app.clock.set(CUTOFF);
  await closeDueRounds(app.deps);
});

afterAll(async () => {
  await app.close();
});

const approvalFor = (subjectId: string) =>
  app.prisma.approvalRequest.findFirstOrThrow({
    where: { type: 'supplier_order', subjectId },
  });

describe('drafting the supplier order', () => {
  it('drafts the condensed milk order for 105 cartons at RM 15,330.00', async () => {
    const so = await supplierOrderOf(cmRound);
    expect(so).toMatchObject({
      quantity: 105,
      acceptedQuantity: 105,
      unitPriceSen: 14600,
      totalSen: 1533000,
      status: 'awaiting_ops',
      requiredDispatchDate: '2026-11-07',
    });
  });

  it('puts the evidence and a passing money check in front of Ops (story 118)', async () => {
    const so = await supplierOrderOf(cmRound);
    const a = await approvalFor(so.id);
    expect(so.opsApprovalId).toBe(a.id);
    expect(a).toMatchObject({
      assigneeRole: 'ops',
      amountSen: 1533000,
      status: 'pending',
      summary: 'Supplier order: 105 cartons of condensed milk, RM 15,330.00',
      whyNeeded: 'Pooled money is committed only after an Ops approval.',
    });
    const e = a.evidence as Record<string, number | { passed: boolean }>;
    expect(e).toMatchObject({
      finalTier: 3,
      quantity: 105,
      shopCount: 9,
      orderCostSen: 1533000,
      moneyCheck: { passed: true },
      roundLink: `/ops/rounds/${cmRound}`,
    });
    expect(e.moneyHeldSen).toBe(
      (e.orderCostSen as number) + (e.feesSen as number) + (e.shippingSen as number),
    );
  });

  it('tells Ops an order is waiting, once', async () => {
    expect(await lastWhatsapp('nadia', 'ops.approval_needed', 'condensed milk')).toBe(
      'Supplier order awaiting approval: condensed milk, RM 15,330.00.',
    );
    const count = await app.prisma.notification.count({
      where: { userId: seedId('user', 'nadia'), type: 'ops.approval_needed' },
    });
    const orders = await app.prisma.supplierOrder.count();
    expect(count).toBe(orders);
  });

  it('logs the draft as the system', async () => {
    const so = await supplierOrderOf(cmRound);
    const log = await app.prisma.activityLogEntry.findFirst({
      where: { action: 'supplier_order.drafted', subjectId: so.id },
    });
    expect(log).not.toBeNull();
  });

  it('drafts nothing for empty or failed rounds', async () => {
    for (const key of ['KRAFT', 'TEA']) {
      const round = await roundOf(key, WEEK);
      expect(round.status).toMatch(/empty|failed/);
      expect(await app.prisma.supplierOrder.count({ where: { roundId: round.id } })).toBe(0);
    }
  });
});
