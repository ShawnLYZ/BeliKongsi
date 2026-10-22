import { describe, expect, it } from 'vitest';
import { tierForTotal, validateTiers } from '@/server/engine';
import { CM_TIERS } from './fixtures';

describe('tier validation', () => {
  it('accepts the condensed milk ladder', () =>
    expect(validateTiers(CM_TIERS, { buyAlonePriceSen: 16800 })).toEqual({ ok: true }));
  it('needs between 1 and 5 tiers', () => {
    expect(validateTiers([])).toMatchObject({
      ok: false,
      errors: [{ code: 'TIER_COUNT', position: null }],
    });
    expect(
      validateTiers(
        Array.from({ length: 6 }, (_, i) => ({ minQuantity: i + 1, unitPriceSen: 100 - i })),
      ),
    ).toMatchObject({ ok: false, errors: [{ code: 'TIER_COUNT' }] });
  });
  it('reports a minimum that does not increase, at its position', () => {
    expect(
      validateTiers([
        { minQuantity: 20, unitPriceSen: 200 },
        { minQuantity: 20, unitPriceSen: 100 },
      ]),
    ).toMatchObject({ ok: false, errors: [{ code: 'MIN_QUANTITY_NOT_INCREASING', position: 2 }] });
  });
  it('reports a price that does not decrease', () => {
    expect(
      validateTiers([
        { minQuantity: 20, unitPriceSen: 15800 },
        { minQuantity: 50, unitPriceSen: 15800 },
      ]),
    ).toMatchObject({ ok: false, errors: [{ code: 'PRICE_NOT_DECREASING', position: 2 }] });
  });
  it('rejects zero or fractional quantities and prices', () => {
    const r = validateTiers([{ minQuantity: 0, unitPriceSen: 10.5 }]);
    expect(r.ok === false && r.errors.map((e) => e.code)).toEqual([
      'MIN_QUANTITY_NOT_POSITIVE_INTEGER',
      'PRICE_NOT_POSITIVE_INTEGER',
    ]);
  });
  it('needs every tier below the buy-alone price', () => {
    expect(
      validateTiers([{ minQuantity: 10, unitPriceSen: 12000 }], { buyAlonePriceSen: 12000 }),
    ).toMatchObject({ ok: false, errors: [{ code: 'PRICE_NOT_BELOW_BUY_ALONE', position: 1 }] });
  });
});

describe('tier lookup', () => {
  it('finds the highest tier reached', () => {
    expect([19, 20, 49, 50, 99, 100, 105].map((t) => tierForTotal(CM_TIERS, t))).toEqual([
      null,
      1,
      1,
      2,
      2,
      3,
      3,
    ]);
  });
});
