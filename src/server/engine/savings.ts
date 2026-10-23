import type { Sen } from './types';

export interface SavingsInput {
  baselineSen: Sen;
  baselineKind: 'usual' | 'buy_alone';
  finalAllInSen: Sen;
  allocated: number;
  missing: number;
  damaged: number;
  verified: boolean;
}

export interface SavingsResult {
  /** Negative when the final all-in price is above the baseline (PRD §6.10). */
  unitSavingSen: number;
  units: number;
  savingSen: number;
  status: 'estimated' | 'verified';
  basis: 'usual_price' | 'buy_alone';
}

/**
 * Saving for one participant. Before the check the estimate counts every allocated unit;
 * once verified, missing and damaged units are taken out.
 */
export function participationSavings(input: SavingsInput): SavingsResult {
  const unitSavingSen = input.baselineSen - input.finalAllInSen;
  const units = input.verified ? input.allocated - input.missing - input.damaged : input.allocated;
  return {
    unitSavingSen,
    units,
    savingSen: unitSavingSen * units,
    status: input.verified ? 'verified' : 'estimated',
    basis: input.baselineKind === 'usual' ? 'usual_price' : 'buy_alone',
  };
}

/**
 * PRD §27: the saving as a percentage of what the same units cost at the usual price, to one
 * decimal. Null when there is no usual cost to compare with.
 */
export function percentSaved(
  lines: { baselineSen: Sen; units: number; savingSen: Sen }[],
): number | null {
  const usualCostSen = lines.reduce((sum, l) => sum + l.baselineSen * l.units, 0);
  if (usualCostSen <= 0) return null;
  const savedSen = lines.reduce((sum, l) => sum + l.savingSen, 0);
  return Math.round((savedSen / usualCostSen) * 1000) / 10;
}
