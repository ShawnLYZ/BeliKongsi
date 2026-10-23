import { describe, expect, it } from 'vitest';
import { claimRefund, participationSavings, percentSaved, unitAmounts } from '@/server/engine';

const cmIpohFinal = unitAmounts(14600, 200, 293);

describe('claim refunds', () => {
  it('refunds a damaged carton at the final all-in price', () =>
    expect(claimRefund({ final: cmIpohFinal, allocated: 6, missing: 0, damaged: 1 })).toEqual({
      ok: true,
      refundSen: 15185,
    }));

  it('refuses more missing plus damaged than allocated', () =>
    expect(claimRefund({ final: cmIpohFinal, allocated: 6, missing: 4, damaged: 3 })).toMatchObject(
      {
        ok: false,
        code: 'MORE_THAN_ALLOCATED',
      },
    ));

  it('refuses a negative missing count', () =>
    expect(
      claimRefund({ final: cmIpohFinal, allocated: 6, missing: -1, damaged: 0 }),
    ).toMatchObject({
      ok: false,
      code: 'NEGATIVE_UNITS',
    }));
});

describe('participation savings', () => {
  it('verifies Kedai Kopi Contoh savings after one damaged carton', () => {
    expect(
      participationSavings({
        baselineSen: 16500,
        baselineKind: 'usual',
        finalAllInSen: 15185,
        allocated: 6,
        missing: 0,
        damaged: 1,
        verified: true,
      }),
    ).toEqual({
      unitSavingSen: 1315,
      units: 5,
      savingSen: 6575,
      status: 'verified',
      basis: 'usual_price',
    });
  });

  it('estimates before the check and labels the buy-alone fallback', () => {
    expect(
      participationSavings({
        baselineSen: 16800,
        baselineKind: 'buy_alone',
        finalAllInSen: 15321,
        allocated: 4,
        missing: 0,
        damaged: 0,
        verified: false,
      }),
    ).toEqual({
      unitSavingSen: 1479,
      units: 4,
      savingSen: 5916,
      status: 'estimated',
      basis: 'buy_alone',
    });
  });

  it('shows a negative saving honestly', () => {
    expect(
      participationSavings({
        baselineSen: 15000,
        baselineKind: 'usual',
        finalAllInSen: 15185,
        allocated: 2,
        missing: 0,
        damaged: 0,
        verified: true,
      }).savingSen,
    ).toBe(-370);
  });
});

describe('percent saved', () => {
  it('compares the saving with the usual cost of the units, to one decimal', () => {
    // 7075 saved on 82500 + 20000 of usual cost = 6.9024...% -> 6.9
    expect(
      percentSaved([
        { baselineSen: 16500, units: 5, savingSen: 6575 },
        { baselineSen: 10000, units: 2, savingSen: 500 },
      ]),
    ).toBe(6.9);
  });

  it('is negative when the final price is above the usual price', () => {
    expect(percentSaved([{ baselineSen: 15000, units: 2, savingSen: -370 }])).toBe(-1.2);
  });

  it('is null when there is nothing to compare with', () => {
    expect(percentSaved([])).toBeNull();
  });

  it('is null when every unit was lost to the check', () => {
    expect(percentSaved([{ baselineSen: 15000, units: 0, savingSen: 0 }])).toBeNull();
  });
});
