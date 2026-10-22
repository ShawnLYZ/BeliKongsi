import type { UnitAmounts } from './amounts';
import type { Sen } from './types';
import { isIntegerInRange } from './validate';

export interface ClaimRefundInput {
  final: UnitAmounts;
  allocated: number;
  missing: number;
  damaged: number;
}

export type ClaimRefundResult =
  | { ok: true; refundSen: Sen }
  | { ok: false; code: 'NEGATIVE_UNITS' | 'MORE_THAN_ALLOCATED'; message: string };

/** PRD §6.8: refund = (missing + damaged) × final all-in unit price. */
export function claimRefund(input: ClaimRefundInput): ClaimRefundResult {
  const { final, allocated, missing, damaged } = input;
  if (![allocated, missing, damaged].every((value) => isIntegerInRange(value, 0))) {
    return {
      ok: false,
      code: 'NEGATIVE_UNITS',
      message: 'Units must be whole numbers, zero or more.',
    };
  }
  const claimed = missing + damaged;
  if (claimed > allocated) {
    return {
      ok: false,
      code: 'MORE_THAN_ALLOCATED',
      message: `Missing and damaged units can't be more than the ${allocated} you received.`,
    };
  }
  return { ok: true, refundSen: claimed * final.allInSen };
}
