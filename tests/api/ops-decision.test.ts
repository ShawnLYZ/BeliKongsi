import { seedId } from '../../prisma/seed/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { createTestApp, type TestApp } from './helpers/app';
import {
  feeChargeOf,
  lastWhatsapp,
  opsApprovalOf,
  order,
  participationOf,
  round,
  roundOf,
  supplierOrderOf,
  toFormed,
} from './helpers/scenarios';

const WEEK = '2026-W45';

let app: TestApp;
let cmRound: string;
let cmOrder: string;
let flourRound: string;
let flourOrder: string;

beforeAll(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toFormed(app);
  cmRound = (await roundOf('CM', WEEK)).id;
  cmOrder = (await supplierOrderOf(cmRound)).id;
  flourRound = (await roundOf('FLOUR', WEEK)).id;
  flourOrder = (await supplierOrderOf(flourRound)).id;
});

afterAll(async () => {
  await app.close();
});

describe('Ops decides supplier orders', () => {
  it('sends the order to the supplier when Ops approves (story 119)', async () => {
    await (
      await app.as('nadia')
    ).post(`/api/approvals/${await opsApprovalOf(cmOrder)}/approve`, {});
    expect(await order(cmOrder)).toMatchObject({ status: 'awaiting_supplier' });
    expect((await round(cmRound)).status).toBe('ordered');
    expect(await lastWhatsapp('farid', 'supplier.new_order')).toBe(
      'New BeliKongsi order: 105 cartons of condensed milk for the Klang Valley hub. Please confirm.',
    );
  });

  it('lets only Ops approve supplier orders', async () => {
    const id = await opsApprovalOf(flourOrder);
    expect((await (await app.as('farid')).post(`/api/approvals/${id}/approve`, {})).status).toBe(
      403,
    );
    // The approve route only admits supplier and ops sessions, so an owner is refused with 403.
    expect((await (await app.as('ahSeng')).post(`/api/approvals/${id}/approve`, {})).status).toBe(
      403,
    );
  });

  it('needs a reason to reject, then refunds everyone in full (stories 65, 120)', async () => {
    const n = await app.as('nadia');
    const id = await opsApprovalOf(flourOrder);
    const sitiShop = seedId('shop', 'GERAI');
    const balanceBefore = await balanceOf(app.prisma, { kind: 'shop_balance', shopId: sitiShop });
    const flourLine = await participationOf('GERAI', 'FLOUR');
    expect(flourLine).toMatchObject({ status: 'kept', quantity: 2, finalAllInSen: 6976 });
    expect((await n.post(`/api/approvals/${id}/reject`, {})).status).toBe(422);
    expect((await round(flourRound)).status).toBe('formed');
    await n.post(`/api/approvals/${id}/reject`, { reason: 'Supplier price dispute' });
    expect((await round(flourRound)).status).toBe('cancelled');
    expect(await order(flourOrder)).toMatchObject({ status: 'rejected_by_ops' });
    expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: flourRound })).toBe(0);
    expect(await participationOf('GERAI', 'FLOUR')).toMatchObject({
      status: 'refunded_round_cancelled',
    });
    // 2 bags at RM 69.76 all in: RM 139.52 back to Gerai Contoh's balance.
    expect(await lastWhatsapp('siti', 'owner.order_rejected')).toBe(
      'BeliKongsi cancelled the flour order this week. Full refund: RM 139.52.',
    );
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: sitiShop })).toBe(
      balanceBefore + 13952,
    );
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('keeps Gerai Contoh’s delivery fee when its other door lines are still kept', async () => {
    // The flour line is gone, but Gerai still has kept door lines for the same date in other rounds.
    expect(await participationOf('GERAI', 'FLOUR')).toMatchObject({
      status: 'refunded_round_cancelled',
      destinationType: 'door',
      deliveryDate: '2026-11-10',
    });
    const others = await app.prisma.participation.findMany({
      where: {
        shopId: seedId('shop', 'GERAI'),
        status: 'kept',
        destinationType: 'door',
        deliveryDate: '2026-11-10',
        roundId: { not: flourRound },
      },
    });
    expect(others.length).toBeGreaterThan(0);
    expect(await feeChargeOf('GERAI', '2026-11-10')).toMatchObject({
      status: 'held',
      amountSen: 1200,
    });
  });
});
