import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { simulatedPayments } from '@/server/adapters/payments';
import { draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { post } from '@/server/modules/ledger/post';
import { openDueRounds } from '@/server/modules/rounds/open';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import { basketOf, lastWhatsapp, paymentOfBasket } from './helpers/scenarios';

const GERAI = seedId('shop', 'GERAI');
const MONDAY_0600 = '2026-11-01T22:00:00Z';
// Gerai's routine basket: 4 items, RM 1,392.20.
const TOTAL_SEN = 139220;
let app: TestApp;

beforeEach(async () => {
  app = await createTestApp({ seed: 'reference' });
  await openDueRounds(app.deps);
});
afterEach(async () => {
  await app.close();
});

async function switchOn(body: Record<string, unknown> = { capSen: 200000 }) {
  const siti = await app.as('siti');
  const res = await siti.put(`/api/shops/${GERAI}/auto-approve`, {
    enabled: true,
    agreeToMandate: true,
    ...body,
  });
  expect(res.status).toBe(200);
  return siti;
}

describe('auto-approve', () => {
  it('needs mandate consent to switch the rule on', async () => {
    const siti = await app.as('siti');
    const refused = await siti.put(`/api/shops/${GERAI}/auto-approve`, { enabled: true });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'MANDATE_REQUIRED' });
    expect(
      (
        await siti.put(`/api/shops/${GERAI}/auto-approve`, {
          enabled: true,
          agreeToMandate: true,
          capSen: 200000,
        })
      ).body,
    ).toMatchObject({
      enabled: true,
      capSen: 200000,
      mandateReference: expect.stringMatching(/^SIM-MANDATE-/),
    });
  });

  it('approves and pays a routine basket automatically (story 40)', async () => {
    await switchOn();
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect((await basketOf('GERAI', '2026-W45')).status).toBe('paid');
    expect((await paymentOfBasket('GERAI')).method).toBe('auto_debit');
    expect(await lastWhatsapp('siti', 'basket.auto_approved')).toBe(
      'Your basket was approved automatically: 4 items, RM 1,392.20 paid by DuitNow AutoDebit (simulated). You can still cancel any item before Thu 8 pm.',
    );
  });

  it('leaves the basket for the owner when the total is over the cap', async () => {
    await switchOn({}); // the default cap is RM 500
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect((await basketOf('GERAI', '2026-W45')).status).toBe('draft');
    expect(await lastWhatsapp('siti', 'basket.auto_approved')).toBeUndefined();
    expect(await lastWhatsapp('siti', 'basket.ready')).toBeDefined();
    expect(await app.prisma.payment.count({ where: { shopId: GERAI } })).toBe(0);
  });

  it('leaves the basket for the owner when a line has no usual price', async () => {
    await switchOn();
    await app.prisma.usualListItem.updateMany({
      where: { usualList: { shopId: GERAI }, productId: seedId('product', 'CM') },
      data: { usualPriceSen: null },
    });
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect((await basketOf('GERAI', '2026-W45')).status).toBe('draft');
    expect(await app.prisma.payment.count({ where: { shopId: GERAI } })).toBe(0);
  });

  it('keeps the basket a draft when the simulated debit fails', async () => {
    await switchOn();
    app.deps.payments = {
      ...simulatedPayments,
      autoDebit: async () => {
        throw new Error('declined');
      },
    };
    app.clock.set(MONDAY_0600);
    expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 2, failed: 0 });
    const basket = await basketOf('GERAI', '2026-W45');
    expect(basket.status).toBe('draft');
    expect(basket.lines.filter((l) => !l.removed)).toHaveLength(4);
    expect(await lastWhatsapp('siti', 'basket.ready')).toBeDefined();
    expect(await lastWhatsapp('siti', 'basket.auto_approve_failed')).toBe(
      'Automatic payment failed (simulated). Please approve and pay your basket by Thu 8 pm.',
    );
  });

  it('writes nothing for a failed debit: no payment, posting or approval log entry', async () => {
    await switchOn();
    app.deps.payments = {
      ...simulatedPayments,
      autoDebit: async () => {
        throw new Error('declined');
      },
    };
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect(await app.prisma.payment.count({ where: { shopId: GERAI } })).toBe(0);
    expect(await app.prisma.ledgerPosting.count({ where: { shopId: GERAI } })).toBe(0);
    expect(
      await app.prisma.activityLogEntry.count({
        where: { shopId: GERAI, action: { in: ['payment.created', 'basket.approved'] } },
      }),
    ).toBe(0);
  });

  it('logs switching off (story 41)', async () => {
    const siti = await switchOn();
    await siti.put(`/api/shops/${GERAI}/auto-approve`, { enabled: false });
    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { shopId: GERAI, action: 'auto_approve.disabled' },
    });
    expect(entry.before).toMatchObject({ enabled: true, capSen: 200000 });
    expect(entry.after).toMatchObject({ enabled: false });
  });

  it('logs every auto-approval as the system with the rule reason (story 41)', async () => {
    await switchOn();
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { shopId: GERAI, action: 'basket.approved' },
    });
    expect(entry.actorType).toBe('system');
    expect(entry.reason).toBe(
      'Auto-approve rule: total within RM 2,000.00 and every item below your usual price',
    );
  });

  it('leaves a basket drafted by a mid-week usual-list save for the owner', async () => {
    const siti = await switchOn();
    app.clock.set('2026-11-03T02:00:00Z'); // Tuesday 10:00 in Malaysia
    const { list } = (await siti.get(`/api/shops/${GERAI}/usual-list`)).body;
    const saved = await siti.put(`/api/shops/${GERAI}/usual-list`, {
      items: list.items.map((i: Record<string, unknown>) => ({
        productId: i.productId,
        quantity: i.quantity,
        usualPriceSen: i.usualPriceSen,
        priceLimitSen: i.priceLimitSen,
      })),
    });
    expect(saved.status).toBe(200);
    const basket = await basketOf('GERAI', '2026-W45');
    expect(basket.status).toBe('draft');
    expect(basket.draftedAt).toBeInstanceOf(Date);
    expect(await app.prisma.payment.count({ where: { shopId: GERAI } })).toBe(0);
    expect(await app.prisma.ledgerPosting.count({ where: { shopId: GERAI } })).toBe(0);
    expect(
      await app.prisma.activityLogEntry.count({
        where: { shopId: GERAI, action: { in: ['payment.created', 'basket.approved'] } },
      }),
    ).toBe(0);
    expect(await lastWhatsapp('siti', 'basket.auto_approved')).toBeUndefined();
  });

  // Condensed milk starts at RM 165.45 all-in on Monday morning.
  it.each([
    ['equal to', 16545],
    ['above', 16544],
  ])('leaves the basket a draft when a starting price is %s the usual price', async (_, usual) => {
    await switchOn();
    await app.prisma.usualListItem.updateMany({
      where: { usualList: { shopId: GERAI }, productId: seedId('product', 'CM') },
      data: { usualPriceSen: usual },
    });
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect((await basketOf('GERAI', '2026-W45')).status).toBe('draft');
    expect(await app.prisma.payment.count({ where: { shopId: GERAI } })).toBe(0);
    expect(await lastWhatsapp('siti', 'basket.ready')).toBeDefined();
  });
});

describe('auto-approve with a balance', () => {
  /** A claim refund already in Gerai's balance. */
  async function giveBalance(amountSen: number) {
    await withTransaction(app.deps, systemCaller('test balance'), (ctx) =>
      post(ctx, {
        from: { kind: 'claims_expense' },
        to: { kind: 'shop_balance', shopId: GERAI },
        amountSen,
        kind: 'refund_claim',
        refs: { shopId: GERAI },
      }),
    );
  }

  /** Sums of the basket payment's postings by kind. */
  async function postingSums(paymentId: string) {
    const rows = await app.prisma.ledgerPosting.groupBy({
      by: ['kind'],
      where: { paymentId },
      _sum: { amountSen: true },
    });
    return Object.fromEntries(rows.map((r) => [r.kind, r._sum.amountSen]));
  }

  it('takes the balance first and debits the rest', async () => {
    await giveBalance(50000);
    await switchOn();
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect((await basketOf('GERAI', '2026-W45')).status).toBe('paid');
    const payment = await paymentOfBasket('GERAI');
    expect(payment).toMatchObject({
      method: 'auto_debit',
      totalSen: TOTAL_SEN,
      balanceAppliedSen: 50000,
      externalSen: 89220,
    });
    // The debit covers the rest of the goods and the RM 12.00 door delivery fee.
    expect(await postingSums(payment.id)).toEqual({
      balance_applied: 50000,
      payment_in: 88020,
      delivery_fee_in: 1200,
    });
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: GERAI })).toBe(0);
    expect(await lastWhatsapp('siti', 'basket.auto_approved')).toBe(
      'Your basket was approved automatically: 4 items, RM 1,392.20 paid — RM 500.00 from your balance and RM 892.20 by DuitNow AutoDebit (simulated). You can still cancel any item before Thu 8 pm.',
    );
  });

  it('pays from the balance alone when it covers the total', async () => {
    await giveBalance(150000);
    await switchOn();
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect((await basketOf('GERAI', '2026-W45')).status).toBe('paid');
    const payment = await paymentOfBasket('GERAI');
    expect(payment).toMatchObject({
      method: 'balance_only',
      totalSen: TOTAL_SEN,
      balanceAppliedSen: TOTAL_SEN,
      externalSen: 0,
      createdByUserId: null,
    });
    expect(await postingSums(payment.id)).toEqual({ balance_applied: TOTAL_SEN });
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: GERAI })).toBe(10780);
    expect(await lastWhatsapp('siti', 'basket.auto_approved')).toBe(
      'Your basket was approved automatically: 4 items, RM 1,392.20 paid from your balance. You can still cancel any item before Thu 8 pm.',
    );
  });
});
