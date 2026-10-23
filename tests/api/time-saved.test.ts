import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { post } from '@/server/modules/ledger/post';
import { openDueRounds } from '@/server/modules/rounds/open';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { basketIdOf, paymentOfBasket, payBasket, setupKedaiKopi } from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const MONDAY_0600 = '2026-11-01T22:00:00Z';
let app: TestApp;

afterEach(async () => {
  await app.close();
});

const settings = (oldMinutesPerWeek?: number | null) => ({
  defaultFulfilment: 'pickup',
  pickupPointId: PP_IPOH,
  ...(oldMinutesPerWeek === undefined ? {} : { oldMinutesPerWeek }),
});
const timeSaved = async (c: Client, shopId: string) =>
  (await c.get(`/api/shops/${shopId}/savings?month=2026-11`)).body.timeSaved;

describe('time saved, manual approval', () => {
  let ah: Client;
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await setupKedaiKopi(app);
    ah = await app.as('ahSeng');
  });

  /** Opened 06:10 and paid 06:13 Malaysia time on Monday 2 Nov (the seed stamps neither). */
  async function payAt(openedAt: string, paidAt: string) {
    const basketId = (await basketIdOf('KEDAI_KOPI', '2026-W45'))!;
    await (
      await app.as('rahim')
    ).post(`/api/baskets/${basketId}/lines`, { productId: seedId('product', 'EM'), quantity: 1 });
    await payBasket(app, 'ahSeng', basketId);
    await app.prisma.weeklyBasket.update({
      where: { id: basketId },
      data: { firstOpenedAt: new Date(openedAt) },
    });
    const payment = await paymentOfBasket('KEDAI_KOPI');
    await app.prisma.payment.update({
      where: { id: payment.id },
      data: { completedAt: new Date(paidAt) },
    });
  }

  it('estimates time saved from the old routine minus measured approval time (story 90)', async () => {
    await payAt('2026-11-01T22:10:00Z', '2026-11-01T22:13:00Z');
    expect((await ah.patch(`/api/shops/${KEDAI}/settings`, settings(45))).status).toBe(200);
    const t = await timeSaved(ah, KEDAI);
    expect(t).toMatchObject({
      oldMinutesPerWeek: 45,
      totalSavedMinutes: 42,
      label: 'estimate',
      weeks: [{ week: '2026-W45', measuredMinutes: 3, savedMinutes: 42 }],
    });
  });

  it('rounds the measured time up and never saves below zero', async () => {
    await payAt('2026-11-01T22:10:00Z', '2026-11-01T22:12:01Z');
    await ah.patch(`/api/shops/${KEDAI}/settings`, settings(2));
    expect((await timeSaved(ah, KEDAI)).weeks).toEqual([
      { week: '2026-W45', measuredMinutes: 3, savedMinutes: 0 },
    ]);
  });

  it('is empty until the owner enters the old routine', async () => {
    await payAt('2026-11-01T22:10:00Z', '2026-11-01T22:13:00Z');
    expect(await timeSaved(ah, KEDAI)).toEqual({
      oldMinutesPerWeek: null,
      weeks: [],
      totalSavedMinutes: 0,
      label: 'estimate',
    });
  });

  it('excludes unpaid weeks', async () => {
    await ah.patch(`/api/shops/${KEDAI}/settings`, settings(45));
    expect(await timeSaved(ah, KEDAI)).toMatchObject({ weeks: [], totalSavedMinutes: 0 });
  });

  it('accepts 0 and 600 and refuses values outside 0 to 600 or non-integers', async () => {
    expect((await ah.patch(`/api/shops/${KEDAI}/settings`, settings(0))).status).toBe(200);
    expect((await ah.patch(`/api/shops/${KEDAI}/settings`, settings(600))).status).toBe(200);
    for (const bad of [601, -1, 4.5]) {
      expect((await ah.patch(`/api/shops/${KEDAI}/settings`, settings(bad))).status).toBe(400);
    }
    expect((await ah.patch(`/api/shops/${KEDAI}/settings`, { oldMinutesPerWeek: 30 })).status).toBe(
      400,
    );
  });

  it('keeps the figure when settings are saved without it', async () => {
    await ah.patch(`/api/shops/${KEDAI}/settings`, settings(45));
    await ah.patch(`/api/shops/${KEDAI}/settings`, settings());
    expect((await timeSaved(ah, KEDAI)).oldMinutesPerWeek).toBe(45);
  });
});

describe('time saved, auto-approval', () => {
  it('counts an auto-approved week as 0 measured minutes', async () => {
    app = await createTestApp({ seed: 'reference' });
    await openDueRounds(app.deps);
    const siti = await app.as('siti');
    expect(
      (
        await siti.put(`/api/shops/${GERAI}/auto-approve`, {
          enabled: true,
          agreeToMandate: true,
          capSen: 200000,
        })
      ).status,
    ).toBe(200);
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect((await paymentOfBasket('GERAI')).method).toBe('auto_debit');
    expect((await siti.patch(`/api/shops/${GERAI}/settings`, settings(45))).status).toBe(200);
    expect(await timeSaved(siti, GERAI)).toMatchObject({
      oldMinutesPerWeek: 45,
      totalSavedMinutes: 45,
      weeks: [{ week: '2026-W45', measuredMinutes: 0, savedMinutes: 45 }],
    });
  });

  it('counts a week paid from the balance alone as 0 measured minutes', async () => {
    app = await createTestApp({ seed: 'reference' });
    await openDueRounds(app.deps);
    // A claim refund of RM 1,500.00 covers Gerai's RM 1,392.20 basket.
    await withTransaction(app.deps, systemCaller('test balance'), (ctx) =>
      post(ctx, {
        from: { kind: 'claims_expense' },
        to: { kind: 'shop_balance', shopId: GERAI },
        amountSen: 150000,
        kind: 'refund_claim',
        refs: { shopId: GERAI },
      }),
    );
    const siti = await app.as('siti');
    expect(
      (
        await siti.put(`/api/shops/${GERAI}/auto-approve`, {
          enabled: true,
          agreeToMandate: true,
          capSen: 200000,
        })
      ).status,
    ).toBe(200);
    app.clock.set(MONDAY_0600);
    await draftWeeklyBaskets(app.deps);
    expect(await paymentOfBasket('GERAI')).toMatchObject({
      method: 'balance_only',
      balanceAppliedSen: 139220,
      externalSen: 0,
    });
    expect((await siti.patch(`/api/shops/${GERAI}/settings`, settings(45))).status).toBe(200);
    expect(await timeSaved(siti, GERAI)).toMatchObject({
      totalSavedMinutes: 45,
      weeks: [{ week: '2026-W45', measuredMinutes: 0, savedMinutes: 45 }],
    });
  });
});
