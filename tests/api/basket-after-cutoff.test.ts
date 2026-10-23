import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { homeSummary } from '@/server/modules/savings/savings';
import { personCaller } from '@/server/platform/caller';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { session } from './helpers/sessions';
import { basketIdOf, payBasket, setupKedaiKopi, toFormed } from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');

let app: TestApp;
let ah: Client;
let beforeCutoff: { status: number; body: { settled: unknown } };

beforeAll(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  const basketId = (await basketIdOf('KEDAI_KOPI', '2026-W45'))!;
  await payBasket(app, 'ahSeng', basketId);
  ah = await app.as('ahSeng');
  beforeCutoff = await ah.get(`/api/shops/${KEDAI}/baskets/current`);
  await toFormed(app);
});

afterAll(async () => {
  await app.close();
});

async function homeBasket() {
  const caller = personCaller(session('ahSeng', 'owner', { shopId: KEDAI }, 'shop'));
  return (await homeSummary(app.deps, caller, KEDAI)).basket!;
}

describe('the owner home basket after the cut-off', () => {
  it('shows what the owner paid, the final price and the refund, exactly in sen', async () => {
    const basket = await homeBasket();
    expect(basket.status).toBe('paid');
    expect(basket.settled).toEqual({
      paidSen: 184860,
      finalSen: 173332,
      refundedSen: 11528,
      estimatedSavingsSen: 16268,
      savingsStatus: 'estimated',
      savingsHasBuyAloneBasis: false,
    });
  });

  it('shows each line at its final price, not a projection, once its round has closed', async () => {
    const cm = (await homeBasket()).lines.find((l) => l.shortName === 'condensed milk')!;
    expect(cm).toMatchObject({
      closed: true,
      quantity: 6,
      projectedAllInSen: 15185,
      estimatedSavingsSen: 7890,
    });
  });

  it('never shows the open-round estimate as a zero for real money', async () => {
    const basket = await homeBasket();
    expect(basket.totals.estimatedAfterCutoffSen).toBe(0);
    expect(basket.settled!.finalSen).toBeGreaterThan(0);
  });

  it('has no settled summary while the rounds are still open', () => {
    expect(beforeCutoff.status).toBe(200);
    expect(beforeCutoff.body.settled).toBeNull();
  });
});

describe('a basket with lines refunded before any goods came', () => {
  it('counts them as paid and refunded, never as kept, exactly in sen', async () => {
    // Cups dropped at the price limit (no final price); coffee refunded although it kept a final price.
    const parts = await app.prisma.participation.findMany({
      where: {
        shopId: KEDAI,
        round: { product: { shortName: { in: ['16 oz cups', 'coffee powder'] } } },
      },
      include: { round: { include: { product: true } } },
    });
    for (const p of parts) {
      const cups = p.round.product.shortName === '16 oz cups';
      await app.prisma.participation.update({
        where: { id: p.id },
        data: cups
          ? { status: 'dropped_price_limit', finalAllInSen: null }
          : { status: 'refunded_round_cancelled' },
      });
    }
    const basket = await homeBasket();
    expect(basket.settled).toEqual({
      paidSen: 184860,
      finalSen: 124760,
      refundedSen: 60100,
      estimatedSavingsSen: 11640,
      savingsStatus: 'estimated',
      savingsHasBuyAloneBasis: false,
    });
    const lines = Object.fromEntries(basket.lines.map((l) => [l.shortName, l]));
    expect(lines['coffee powder']!.estimatedSavingsSen).toBeNull();
    expect(lines['16 oz cups']!.estimatedSavingsSen).toBeNull();
    expect(lines['condensed milk']!.estimatedSavingsSen).toBe(7890);
  });
});
