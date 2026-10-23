import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import {
  basketIdOf,
  lastWhatsapp,
  openRoundOf,
  payBasket,
  setupKedaiKopi,
} from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const WEEK = '2026-W45';
// The shop balance after the demo cut-off: its refunds for condensed milk (RM 73.44) and the rest.
const BALANCE_SEN = 11528;

let app: TestApp;
let ah: Client;
let n = 0;

const withdraw = (body: unknown, key = `wd-${++n}`) =>
  ah.post(`/api/shops/${KEDAI}/balance/withdraw`, body, { 'idempotency-key': key });
const balance = () => balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI });

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', WEEK))!);
  await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
  ah = await app.as('ahSeng');
});
afterEach(async () => {
  await app.close();
});

describe('withdrawing the balance', () => {
  it('pays the balance out to the partner (story 60)', async () => {
    const res = await withdraw({ amountSen: 7344 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      amountSen: 7344,
      partnerReference: expect.stringMatching(/^SIM-WD-/),
      balanceSen: BALANCE_SEN - 7344,
    });
    expect(await balance()).toBe(BALANCE_SEN - 7344);
    expect(await app.prisma.withdrawal.findMany({ where: { shopId: KEDAI } })).toMatchObject([
      { amountSen: 7344, partnerReference: res.body.partnerReference },
    ]);
    expect(
      await app.prisma.ledgerPosting.count({ where: { kind: 'withdrawal', shopId: KEDAI } }),
    ).toBe(1);
    expect(
      await app.prisma.activityLogEntry.findFirst({ where: { action: 'balance.withdrawn' } }),
    ).toMatchObject({ shopId: KEDAI });
    expect(
      await app.prisma.integrationEvent.findMany({ where: { type: 'balance.withdrawn' } }),
    ).toMatchObject([{ data: { shopId: KEDAI, amountSen: 7344 } }]);
    expect(await lastWhatsapp('ahSeng', 'balance.withdrawn')).toBe(
      `Withdrawal sent (simulated): RM 73.44 to the bank account registered with the payments partner. Reference ${res.body.partnerReference}.`,
    );
    expect(
      await app.prisma.notification.findFirstOrThrow({ where: { type: 'balance.withdrawn' } }),
    ).toMatchObject({ link: '/owner/money', shopId: KEDAI });
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('can empty the balance to zero', async () => {
    expect((await withdraw({ amountSen: BALANCE_SEN })).body.balanceSen).toBe(0);
    expect(await balance()).toBe(0);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it.each([0, 1.5, -5, 999_999_999])('refuses an amount of %s', async (amountSen) => {
    const res = await withdraw({ amountSen });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(await balance()).toBe(BALANCE_SEN);
    expect(await app.prisma.withdrawal.count()).toBe(0);
    expect(await app.prisma.ledgerPosting.count({ where: { kind: 'withdrawal' } })).toBe(0);
  });

  it('lets only one of two parallel withdrawals take the same money', async () => {
    const half = BALANCE_SEN - 1000;
    const [a, b] = await Promise.all([
      withdraw({ amountSen: half }),
      withdraw({ amountSen: half }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
    expect([a, b].find((r) => r.status === 422)!.body).toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(await balance()).toBe(1000);
    expect(await app.prisma.withdrawal.count()).toBe(1);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('answers 400 to a missing or non-number amount', async () => {
    expect((await withdraw({})).status).toBe(400);
    expect((await withdraw({ amountSen: '100' })).status).toBe(400);
  });

  it('replays the first answer for the same Idempotency-Key', async () => {
    const a = await withdraw({ amountSen: 1000 }, 'same');
    const b = await withdraw({ amountSen: 1000 }, 'same');
    expect(b.body).toEqual(a.body);
    expect(await app.prisma.withdrawal.count()).toBe(1);
    expect(await balance()).toBe(BALANCE_SEN - 1000);
  });

  it('is for the shop owner only', async () => {
    expect(
      (
        await (
          await app.as('rahim')
        ).post(
          `/api/shops/${KEDAI}/balance/withdraw`,
          { amountSen: 100 },
          { 'idempotency-key': 'staff' },
        )
      ).status,
    ).toBe(403);
    expect(await balance()).toBe(BALANCE_SEN);
  });

  it('shows the withdrawal in the money history with its partner reference', async () => {
    const res = await withdraw({ amountSen: 7344 });
    const { items } = (await ah.get(`/api/shops/${KEDAI}/balance`)).body.history;
    expect(items[0]).toMatchObject({
      kind: 'withdrawal',
      label: 'Withdrawal (simulated)',
      amountSen: 7344,
      balanceChangeSen: -7344,
      runningBalanceSen: BALANCE_SEN - 7344,
      reason: `Reference ${res.body.partnerReference}`,
    });
    expect(res.body.partnerReference).toMatch(/^SIM-WD-/);
  });
});

describe('withdrawing while a payment is pending', () => {
  // Condensed milk (RM 164.09) waits for the checkout and sets aside the RM 47.27 the flour left.
  const RESERVED_SEN = 4727;
  // The flour refund (RM 68.01) is the only money free to withdraw.
  const AVAILABLE_SEN = 6801;
  let pendingId: string;

  /**
   * Flour is paid from the balance; condensed milk costs more than what is left, so it waits for
   * the checkout with the rest of the balance set aside. Cancelling the flour refunds it.
   */
  beforeEach(async () => {
    const flour = await ah.post(`/api/rounds/${(await openRoundOf('FLOUR')).id}/participations`, {
      quantity: 1,
    });
    expect(flour.body).toMatchObject({ status: 'succeeded', balanceAppliedSen: 6801 });
    const cm = await ah.post(`/api/rounds/${(await openRoundOf('CM')).id}/participations`, {
      quantity: 1,
    });
    expect(cm.body).toMatchObject({
      status: 'pending',
      totalSen: 16409,
      balanceAppliedSen: RESERVED_SEN,
      externalSen: 11682,
    });
    pendingId = cm.body.paymentId;
    const part = await app.prisma.participation.findFirstOrThrow({
      where: { paymentId: flour.body.paymentId },
    });
    expect((await ah.post(`/api/participations/${part.id}/cancel`)).status).toBe(200);
    expect(await balance()).toBe(BALANCE_SEN);
  });

  it('refuses the balance a pending payment has set aside', async () => {
    const res = await withdraw({ amountSen: BALANCE_SEN });
    expect(res).toMatchObject({
      status: 422,
      body: {
        code: 'INVALID_AMOUNT',
        details: { balanceSen: BALANCE_SEN, availableSen: AVAILABLE_SEN },
      },
    });
    expect(await balance()).toBe(BALANCE_SEN);
    expect(await app.prisma.withdrawal.count()).toBe(0);
  });

  it('shows the available amount on the balance view', async () => {
    expect((await ah.get(`/api/shops/${KEDAI}/balance`)).body).toMatchObject({
      balanceSen: BALANCE_SEN,
      availableSen: AVAILABLE_SEN,
    });
  });

  it('pays out the available amount, and the pending checkout still settles', async () => {
    const res = await withdraw({ amountSen: AVAILABLE_SEN });
    expect(res.status).toBe(200);
    expect(res.body.balanceSen).toBe(RESERVED_SEN);
    expect(await balance()).toBe(RESERVED_SEN);

    const paid = await ah.post(`/api/payments/${pendingId}/simulate`, {
      outcome: 'succeeded',
      method: 'duitnow_qr',
    });
    expect(paid.body).toMatchObject({ status: 'succeeded', balanceAppliedSen: RESERVED_SEN });
    expect(await balance()).toBe(0);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });
});
