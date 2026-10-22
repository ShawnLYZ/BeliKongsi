import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { seedDemo } from '../../prisma/seed';
import { verifyLogChain } from '@/server/modules/activity/log';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { roundProgress } from '@/server/modules/rounds/read';
import { systemCaller } from '@/server/platform/caller';
import { setTransactionNow, withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import {
  basketIdOf,
  basketOf,
  feeChargeOf,
  participationOf,
  payBasket,
  setupKedaiKopi,
  totalsByProductKey,
} from './helpers/scenarios';

/** Fri 30 Oct 09:00 MYT and Sun 1 Nov 21:00 MYT: the first and the last background join. */
const FIRST_JOIN = '2026-10-30T01:00:00.000Z';
const LAST_JOIN = '2026-11-01T13:00:00.000Z';
/** Thu 29 Oct 20:00 MYT. */
const OPENED_AT = '2026-10-29T12:00:00.000Z';
/** Mon 2 Nov 06:00, 06:01 and 06:03 MYT. */
const DRAFTED_AT = '2026-11-01T22:00:00.000Z';
const GERAI_PAID_AT = '2026-11-01T22:01:00.000Z';
const KAFE_PAID_AT = '2026-11-01T22:03:00.000Z';

let app: TestApp;
let cmRound: string;

describe('the seeded demo week', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    cmRound = (
      await app.prisma.round.findFirstOrThrow({
        where: { productId: seedId('product', 'CM'), status: 'open' },
      })
    ).id;
  });
  afterEach(async () => {
    await app.close();
  });

  it('opens every round on Thursday 8 pm with the demo week’s cut-off', async () => {
    const rounds = await app.prisma.round.findMany({ where: { status: 'open' } });
    expect(rounds).toHaveLength(12);
    for (const r of rounds) {
      expect(r.opensAt.toISOString()).toBe(OPENED_AT);
      expect(r.cutoffAt.toISOString()).toBe('2026-11-05T12:00:00.000Z');
      expect(r.cycleLabel).toBe('2026-W45');
    }
  });

  it('lands every round on the designed totals (index §5.7)', async () => {
    expect(await totalsByProductKey(app)).toEqual({
      CM: 99,
      EM: 57,
      OIL: 104,
      FLOUR: 25,
      COFFEE: 29,
      TEA: 6,
      EGG_A: 320,
      EGG_B: 130,
      CUPS: 29,
      CONT: 15,
      BAGS: 51,
      KRAFT: 0,
    });
    expect((await roundProgress(app.prisma, cmRound)).shopCount).toBe(8);
  });

  it('gives each background shop two or three rounds, joined Friday to Sunday', async () => {
    const rows = await app.prisma.participation.findMany({
      where: { shop: { isBackground: true } },
      orderBy: { joinedAt: 'asc' },
    });
    expect(rows).toHaveLength(81);
    expect(rows.every((r) => r.source === 'background_seed' && r.status === 'active')).toBe(true);
    expect(rows[0]!.joinedAt.toISOString()).toBe(FIRST_JOIN);
    expect(rows.at(-1)!.joinedAt.toISOString()).toBe(LAST_JOIN);

    const byShop = new Map<string, string[]>();
    for (const r of rows) byShop.set(r.shopId, [...(byShop.get(r.shopId) ?? []), r.roundId]);
    expect(byShop.size).toBe(40);
    for (const roundIds of byShop.values()) {
      expect(roundIds.length).toBeGreaterThanOrEqual(2);
      expect(roundIds.length).toBeLessThanOrEqual(3);
      expect(new Set(roundIds).size).toBe(roundIds.length);
    }
    // BG01 gets k = 0 (CM 20), k = 40 (EGG_A 30) and k = 80 (BAGS 3), the only shop with three.
    const bg01 = rows.filter((r) => r.shopId === seedId('shop', 'BG01'));
    expect(bg01.map((r) => r.quantity)).toEqual([20, 30, 3]);
  });

  it('charges each door background shop one delivery fee per date and pays every join by FPX', async () => {
    const payments = await app.prisma.payment.findMany({
      where: { shop: { isBackground: true } },
    });
    expect(payments).toHaveLength(81);
    expect(payments.every((p) => p.status === 'succeeded' && p.method === 'fpx')).toBe(true);
    const doorShops = ['BG05', 'BG10', 'BG15', 'BG20', 'BG25', 'BG30', 'BG35', 'BG40'];
    for (const key of doorShops) {
      expect(await feeChargeOf(key, '2026-11-10')).toMatchObject({ status: 'held' });
    }
    expect(await feeChargeOf('BG01', '2026-11-10')).toBeNull();
  });

  it('drafts Gerai’s and Kafe’s baskets at 06:00 from their usual lists', async () => {
    const gerai = await basketOf('GERAI', '2026-W45');
    const kafe = await basketOf('KAFE', '2026-W45');
    expect(gerai.draftedAt?.toISOString()).toBe(DRAFTED_AT);
    expect(kafe.draftedAt?.toISOString()).toBe(DRAFTED_AT);
    expect(gerai.lines.map((l) => [l.productKey, l.quantity])).toEqual([
      ['CM', 4],
      ['EM', 2],
      ['FLOUR', 2],
      ['CONT', 3],
    ]);
    expect(kafe.lines.map((l) => [l.productKey, l.quantity])).toEqual([
      ['CM', 3],
      ['COFFEE', 2],
      ['EGG_B', 10],
      ['CUPS', 3],
    ]);
    expect(await basketIdOf('KEDAI_KOPI', '2026-W45')).toBeUndefined();
  });

  it('has Gerai and Kafe paid at 06:01 and 06:03, with Gerai’s door fee held', async () => {
    const gerai = await basketOf('GERAI', '2026-W45');
    const kafe = await basketOf('KAFE', '2026-W45');
    expect(gerai).toMatchObject({ status: 'paid', approvedByUserId: seedId('user', 'siti') });
    expect(kafe).toMatchObject({ status: 'paid', approvedByUserId: seedId('user', 'mei') });
    expect(gerai.approvedAt?.toISOString()).toBe(GERAI_PAID_AT);
    expect(kafe.approvedAt?.toISOString()).toBe(KAFE_PAID_AT);

    const geraiPayment = await app.prisma.payment.findFirstOrThrow({
      where: { basketId: gerai.id },
    });
    const kafePayment = await app.prisma.payment.findFirstOrThrow({ where: { basketId: kafe.id } });
    expect(geraiPayment).toMatchObject({ status: 'succeeded', method: 'duitnow_qr' });
    expect(kafePayment).toMatchObject({ status: 'succeeded', method: 'fpx' });

    expect(await feeChargeOf('GERAI', '2026-11-10')).toMatchObject({
      amountSen: 1200,
      status: 'held',
      paymentId: geraiPayment.id,
    });
    expect((await participationOf('GERAI', 'CM')).joinedAt.toISOString()).toBe(GERAI_PAID_AT);
    expect(await participationOf('KAFE', 'EGG_B')).toMatchObject({
      quantity: 10,
      priceLimitSen: 1220,
      paidSen: 12330,
      source: 'weekly_basket',
    });
    expect((await participationOf('KAFE', 'EGG_B')).joinedAt.toISOString()).toBe(KAFE_PAID_AT);
  });

  it('reaches 105 cartons at tier 3 once Kedai Kopi Contoh pays (milestone check)', async () => {
    await setupKedaiKopi(app);
    await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', '2026-W45'))!);
    expect(await roundProgress(app.prisma, cmRound)).toMatchObject({
      totalQuantity: 105,
      shopCount: 9,
      currentTier: 3,
    });
  });

  it('passes every money check and log verification after seeding', async () => {
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
    expect((await verifyLogChain(app.prisma)).valid).toBe(true);
  });
});

describe('the transaction clock', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'none' });
  });
  afterEach(async () => {
    await app.close();
  });

  it('gives later joined transactions the time set with setTransactionNow', async () => {
    const later = new Date('2026-11-03T00:00:00Z');
    const seen = await withTransaction(app.deps, systemCaller('outer'), async () => {
      setTransactionNow(later);
      return withTransaction(app.deps, systemCaller('inner'), async (ctx) => ctx.now);
    });
    expect(seen.toISOString()).toBe(later.toISOString());
  });

  it('does nothing outside a transaction', async () => {
    setTransactionNow(new Date('2030-01-01T00:00:00Z'));
    const now = await withTransaction(app.deps, systemCaller('alone'), async (ctx) => ctx.now);
    expect(now.toISOString()).toBe('2026-11-01T22:05:00.000Z');
  });

  it('restores the outer transaction’s time after seeding the week', async () => {
    const outerNow = new Date('2026-10-22T03:00:00Z');
    app.clock.set(outerNow.toISOString());
    const seen = await withTransaction(
      app.deps,
      systemCaller('reset'),
      async () => {
        await seedDemo(app.deps, { anchorMonday: new Date('2026-11-01T22:05:00Z') });
        return withTransaction(app.deps, systemCaller('after seed'), async (ctx) => ctx.now);
      },
      { timeoutMs: 120_000 },
    );
    expect(seen.toISOString()).toBe(outerNow.toISOString());
  });
});
