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
