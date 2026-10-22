import { describe, expect, it } from 'vitest';
import { unitAmounts } from '@/server/engine';
import { FEE_BPS } from './fixtures';

describe('unit amounts', () => {
  it.each([
    [
      'condensed milk, Ipoh, starting',
      15800,
      293,
      { goodsSen: 15800, feeSen: 316, shippingSen: 293, allInSen: 16409 },
    ],
    [
      'condensed milk, Ipoh, tier 3',
      14600,
      293,
      { goodsSen: 14600, feeSen: 292, shippingSen: 293, allInSen: 15185 },
    ],
    [
      'condensed milk, Johor Bahru, starting',
      15800,
      429,
      { goodsSen: 15800, feeSen: 316, shippingSen: 429, allInSen: 16545 },
    ],
    [
      'condensed milk, Johor Bahru, tier 3',
      14600,
      429,
      { goodsSen: 14600, feeSen: 292, shippingSen: 429, allInSen: 15321 },
    ],
    [
      'Grade B eggs, Kuantan, tier 1',
      1170,
      40,
      { goodsSen: 1170, feeSen: 23, shippingSen: 40, allInSen: 1233 },
    ],
    [
      'Grade B eggs, Kuantan, tier 2',
      1130,
      40,
      { goodsSen: 1130, feeSen: 23, shippingSen: 40, allInSen: 1193 },
    ],
  ])('%s', (_name, goods, ship, expected) =>
    expect(unitAmounts(goods, FEE_BPS, ship)).toEqual(expected),
  );
});
