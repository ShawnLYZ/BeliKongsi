import type { Sen } from './types';

const BASIS_POINTS_PER_WHOLE = 10_000;

/**
 * Divides `numerator` by `denominator` and rounds half up to a whole number.
 * Both arguments must be safe integers: the numerator non-negative, the denominator positive.
 */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError(`numerator must be a non-negative safe integer, got ${numerator}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`denominator must be a positive safe integer, got ${denominator}`);
  }
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return 2 * remainder >= denominator ? quotient + 1 : quotient;
}

/** The fee on one unit: goods × fee basis points ÷ 10,000, rounded half up to whole sen. */
export function feeSen(goodsSen: Sen, feeBps: number): Sen {
  return roundHalfUpDiv(goodsSen * feeBps, BASIS_POINTS_PER_WHOLE);
}

const ringgitFormat = new Intl.NumberFormat('en-MY');

/** Displays sen as `RM 1,234.56`. The grouping is locale formatting; the sen part is integer arithmetic. */
export function formatRM(sen: Sen): string {
  const sign = sen < 0 ? '-' : '';
  const absolute = Math.abs(sen);
  const ringgit = Math.floor(absolute / 100);
  const cents = absolute % 100;
  return `${sign}RM ${ringgitFormat.format(ringgit)}.${String(cents).padStart(2, '0')}`;
}

/** Counts units with the unit name, pluralised by adding "s" unless the quantity is 1. */
export function formatUnits(quantity: number, unitName: string): string {
  return `${quantity} ${quantity === 1 ? unitName : `${unitName}s`}`;
}
