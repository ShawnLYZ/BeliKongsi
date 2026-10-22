import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks, type MoneyCheckId } from '@/server/modules/ledger/checks';
import { post } from '@/server/modules/ledger/post';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestDeps } from './helpers/app';

const sys = systemCaller('test');
const S = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';

let t: Awaited<ReturnType<typeof createTestDeps>>;
beforeEach(async () => {
  t = await createTestDeps();
});
afterEach(async () => {
  await t.close();
});

async function adminExec(sql: string): Promise<void> {
  const client = new Client({ connectionString: t.db.adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
const check = async (id: MoneyCheckId) =>
  (await runMoneyChecks(t.deps.prisma)).checks.find((c) => c.id === id);
const payIn = (amountSen: number) =>
  withTransaction(t.deps, sys, (ctx) =>
    post(ctx, {
      from: { kind: 'partner_cash' },
      to: { kind: 'round_hold', roundId: R },
      amountSen,
      kind: 'payment_in',
    }),
  );

describe('ledger', () => {
  it('moves money between accounts and keeps the books at zero', async () => {
    await payIn(98454);
    expect(await balanceOf(t.deps.prisma, { kind: 'round_hold', roundId: R })).toBe(98454);
    expect(await balanceOf(t.deps.prisma, { kind: 'partner_cash' })).toBe(-98454);
    const report = await runMoneyChecks(t.deps.prisma);
    expect(report.checks.find((c) => c.id === 'balances_sum_to_zero')?.passed).toBe(true);
    expect(report.checks.find((c) => c.id === 'cached_balances_match_postings')?.passed).toBe(true);
  });

  it('refuses to take a shop balance below zero', async () => {
    await expect(
      withTransaction(t.deps, sys, (ctx) =>
        post(ctx, {
          from: { kind: 'shop_balance', shopId: S },
          to: { kind: 'round_hold', roundId: R },
          amountSen: 1,
          kind: 'balance_applied',
        }),
      ),
    ).rejects.toMatchObject({ status: 422, code: 'BALANCE_WOULD_GO_NEGATIVE' });
    expect(await balanceOf(t.deps.prisma, { kind: 'round_hold', roundId: R })).toBe(0);
  });

  it('refuses zero, negative and fractional amounts', async () => {
    for (const amountSen of [0, -5, 1.5]) {
      await expect(payIn(amountSen)).rejects.toThrow();
    }
    expect(await balanceOf(t.deps.prisma, { kind: 'partner_cash' })).toBe(0);
  });

  it('lets a round hold pay out up to what it holds and no further', async () => {
    await payIn(1000);
    const out = (amountSen: number) =>
      withTransaction(t.deps, sys, (ctx) =>
        post(ctx, {
          from: { kind: 'round_hold', roundId: R },
          to: { kind: 'shop_balance', shopId: S },
          amountSen,
          kind: 'refund_dropped',
        }),
      );
    await out(1000);
    await expect(out(1)).rejects.toMatchObject({ code: 'BALANCE_WOULD_GO_NEGATIVE' });
    expect(await balanceOf(t.deps.prisma, { kind: 'shop_balance', shopId: S })).toBe(1000);
  });

  it('flags a cached balance that drifted from its postings', async () => {
    await payIn(500);
    await adminExec(
      `update ledger_accounts set balance_sen = balance_sen + 1 where key = 'partner_cash'`,
    );
    expect(await check('cached_balances_match_postings')).toMatchObject({ passed: false });
    expect(await check('balances_sum_to_zero')).toMatchObject({ passed: false });
  });

  it('flags an account that went negative when it should not', async () => {
    await payIn(500);
    await adminExec(
      `alter table ledger_accounts drop constraint ledger_accounts_balance_not_negative;
       update ledger_accounts set balance_sen = -1 where key = 'round_hold:${R}';`,
    );
    const c = await check('no_negative_balances');
    expect(c?.passed).toBe(false);
    expect(c?.failures[0]?.detail).toContain('round_hold');
  });

  it('flags a delivery fee hold that does not match its held charge', async () => {
    const D = '2026-11-10';
    const fee = (amountSen: number) =>
      withTransaction(t.deps, sys, (ctx) =>
        post(ctx, {
          from: { kind: 'partner_cash' },
          to: { kind: 'delivery_fee_hold', shopId: S, deliveryDate: D },
          amountSen,
          kind: 'delivery_fee_in',
        }),
      );
    await fee(1200);
    const c = await check('delivery_fee_holds_match_charges');
    expect(c?.passed).toBe(false);
    expect(c?.failures[0]?.detail).toContain(D);
    const charge = await t.deps.prisma.deliveryFeeCharge.create({
      data: { shopId: S, deliveryDate: D, amountSen: 1200, paymentId: R, status: 'held' },
    });
    expect(await check('delivery_fee_holds_match_charges')).toMatchObject({ passed: true });
    await t.deps.prisma.deliveryFeeCharge.update({
      where: { id: charge.id },
      data: { status: 'refunded' },
    });
    expect(await check('delivery_fee_holds_match_charges')).toMatchObject({ passed: false });
  });

  it('passes every check on a clean database', async () => {
    const report = await runMoneyChecks(t.deps.prisma);
    expect(report.checks.map((c) => c.id)).toEqual([
      'balances_sum_to_zero',
      'no_negative_balances',
      'cached_balances_match_postings',
      'round_holds_match_participations',
      'participation_paid_equals_refunds_plus_allocated',
      'kept_within_limits',
      'final_not_above_starting',
      'delivery_fee_holds_match_charges',
    ]);
    expect(report.allPassed).toBe(true);
  });
});
