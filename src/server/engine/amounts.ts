import { feeSen } from './money';
import type { Sen } from './types';

/** Every amount for one unit, in whole sen. `allInSen` is goods + fee + shipping. */
export interface UnitAmounts {
  goodsSen: Sen;
  feeSen: Sen;
  shippingSen: Sen;
  allInSen: Sen;
}

export function unitAmounts(goodsSen: Sen, feeBps: number, unitShippingSen: Sen): UnitAmounts {
  const fee = feeSen(goodsSen, feeBps);
  return {
    goodsSen,
    feeSen: fee,
    shippingSen: unitShippingSen,
    allInSen: goodsSen + fee + unitShippingSen,
  };
}
