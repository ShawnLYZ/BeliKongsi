import { describe, expect, it } from 'vitest';
import { EngineInputError, quote } from '@/server/engine';
import type { QuoteInput } from '@/server/engine';
import { CM_TIERS, EGG_B_TIERS } from './fixtures';

const cm = (q: Partial<QuoteInput> = {}) =>
  quote({
    tiers: CM_TIERS,
    feeBps: 200,
    unitShippingSen: 293,
    quantity: 6,
    currentRoundTotal: 99,
    unitName: 'carton',
    ...q,
  });

describe('quote', () => {
  it('shows the round without you and with you (C1)', () => {
    const r = cm();
    expect(r.starting.allInSen).toBe(16409);
    expect(r.startingLineSen).toBe(98454);
    expect(r.withoutYou).toMatchObject({
      total: 99,
      tier: 2,
      unitsToNextTier: 1,
      nextTier: { position: 3, minQuantity: 100, unitPriceSen: 14600 },
    });
    expect(r.withYou).toMatchObject({
      total: 105,
      tier: 3,
      amounts: { allInSen: 15185 },
      unitsToNextTier: null,
      nextTier: null,
    });
    expect(r.explanation).toEqual([
      'You pay RM 164.09 a carton now: the starting price. Anything above the final price comes back to your balance at cut-off.',
      '99 cartons so far. 1 more carton and everyone pays RM 146.00.',
      'Your 6 cartons take it to 105: the RM 146.00 tier.',
      'Your all-in price: RM 151.85 (RM 146.00 goods + RM 2.92 BeliKongsi fee + RM 2.93 shipping).',
    ]);
  });

  it('warns when the limit is below the starting price (Kafe Contoh, Grade B eggs)', () => {
    const r = quote({
      tiers: EGG_B_TIERS,
      feeBps: 200,
      unitShippingSen: 40,
      quantity: 10,
      currentRoundTotal: 120,
      priceLimitSen: 1220,
      unitName: 'tray',
    });
    expect(r.limit).toEqual({
      priceLimitSen: 1220,
      belowStarting: true,
      lowestTierMeetingLimit: { position: 2, minQuantity: 300, unitPriceSen: 1130, allInSen: 1193 },
    });
    expect(r.explanation).toContain("You'll only be in if the round reaches 300+ trays.");
  });

  it('says so when no tier meets the limit', () => {
    const r = quote({
      tiers: EGG_B_TIERS,
      feeBps: 200,
      unitShippingSen: 40,
      quantity: 10,
      currentRoundTotal: 0,
      priceLimitSen: 1000,
      unitName: 'tray',
    });
    expect(r.limit?.lowestTierMeetingLimit).toBeNull();
    expect(r.explanation).toContain(
      'No price tier is within your limit of RM 10.00, so this line would be refunded at cut-off.',
    );
  });

  it('explains a round still below its minimum', () => {
    const r = cm({ quantity: 2, currentRoundTotal: 10 });
    expect(r.withYou).toMatchObject({ total: 12, tier: null, amounts: null, unitsToNextTier: 8 });
    expect(r.explanation).toContain(
      "The round needs 8 more cartons to reach its minimum of 20. If it doesn't, everyone is refunded in full.",
    );
  });

  it('says the top tier is reached when the round is already there without you', () => {
    const r = cm({ currentRoundTotal: 100 });
    expect(r.withoutYou).toMatchObject({ tier: 3, unitsToNextTier: null, nextTier: null });
    expect(r.explanation[1]).toBe('100 cartons so far: the top tier, RM 146.00.');
  });

  it('gives no limit sentence when the limit is at or above the starting price', () => {
    const r = cm({ priceLimitSen: 16409 });
    expect(r.limit).toMatchObject({ belowStarting: false });
    expect(r.explanation).toHaveLength(4);
  });

  it('has no limit when none is given', () => {
    expect(cm().limit).toBeNull();
  });

  it('rejects bad input listing every bad field', () => {
    const tiers = [CM_TIERS[0]!, { minQuantity: 20, unitPriceSen: 15200 }];
    let error: unknown;
    try {
      cm({ tiers, quantity: 0 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EngineInputError);
    expect((error as EngineInputError).fields.map((f) => f.path)).toEqual([
      'tiers[1].minQuantity',
      'quantity',
    ]);
  });
});
