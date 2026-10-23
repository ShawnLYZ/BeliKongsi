import { describe, expect, it } from 'vitest';
import type { WeeklyBasket } from '@/generated/prisma/client';
import { settledSummary } from '@/server/modules/baskets/basket';

type Part = Parameters<typeof settledSummary>[1][number];

const basket = { status: 'paid' } as WeeklyBasket;

/** Condensed milk: 6 cartons paid at 15,500 each, usual price 16,500, final all-in 15,185. */
function condensedMilk(over: Partial<Part> = {}, allocation: Part['allocation'] = null): Part {
  return {
    quantity: 6,
    status: 'closed',
    paidSen: 93_000,
    baselineSen: 16_500,
    baselineKind: 'usual',
    finalAllInSen: 15_185,
    allocation,
    ...over,
  } as Part;
}

describe('the settled basket summary', () => {
  it('prices every ordered unit before the hub check has allocated any', () => {
    expect(settledSummary(basket, [condensedMilk()])).toEqual({
      paidSen: 93_000,
      finalSen: 91_110,
      refundedSen: 1_890,
      estimatedSavingsSen: 7_890,
      savingsStatus: 'estimated',
      savingsHasBuyAloneBasis: false,
    });
  });

  it('prices only the allocated units after a hub shortfall, so the shortfall is refunded too', () => {
    const short = condensedMilk({}, { allocated: 4, checkLines: [] });
    expect(settledSummary(basket, [short])).toEqual({
      paidSen: 93_000,
      finalSen: 60_740,
      refundedSen: 32_260,
      estimatedSavingsSen: 5_260,
      savingsStatus: 'estimated',
      savingsHasBuyAloneBasis: false,
    });
  });

  it('is verified once every kept line has been checked, on the units that arrived', () => {
    const checked = condensedMilk(
      {},
      { allocated: 6, checkLines: [{ missing: 0, damaged: 1, receivedGood: 5 }] },
    );
    expect(settledSummary(basket, [checked])).toEqual({
      paidSen: 93_000,
      finalSen: 91_110,
      refundedSen: 1_890,
      estimatedSavingsSen: 6_575,
      savingsStatus: 'verified',
      savingsHasBuyAloneBasis: false,
    });
  });

  it('stays estimated while one kept line is still unchecked', () => {
    const checked = condensedMilk(
      {},
      { allocated: 6, checkLines: [{ missing: 0, damaged: 0, receivedGood: 6 }] },
    );
    const summary = settledSummary(basket, [checked, condensedMilk()]);
    expect(summary!.savingsStatus).toBe('estimated');
  });

  it('is estimated, not verified, when every line was refunded and nothing was kept', () => {
    const dropped = condensedMilk({ status: 'dropped_price_limit', finalAllInSen: null });
    expect(settledSummary(basket, [dropped])).toEqual({
      paidSen: 93_000,
      finalSen: 0,
      refundedSen: 93_000,
      estimatedSavingsSen: 0,
      savingsStatus: 'estimated',
      savingsHasBuyAloneBasis: false,
    });
  });
});
