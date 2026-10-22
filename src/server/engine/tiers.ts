import type { Sen, Tier } from './types';

export type TierErrorCode =
  | 'TIER_COUNT'
  | 'MIN_QUANTITY_NOT_POSITIVE_INTEGER'
  | 'MIN_QUANTITY_NOT_INCREASING'
  | 'PRICE_NOT_POSITIVE_INTEGER'
  | 'PRICE_NOT_DECREASING'
  | 'PRICE_NOT_BELOW_BUY_ALONE';

export interface TierError {
  code: TierErrorCode;
  /** 1-based tier position, or null when the error concerns the whole ladder. */
  position: number | null;
  message: string;
}

export interface TierValidationOptions {
  buyAlonePriceSen?: Sen;
}

const MIN_TIERS = 1;
const MAX_TIERS = 5;

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Checks a tier ladder and reports every error, not just the first. */
export function validateTiers(
  tiers: Tier[],
  opts: TierValidationOptions = {},
): { ok: true } | { ok: false; errors: TierError[] } {
  const errors: TierError[] = [];
  const add = (code: TierErrorCode, position: number | null, message: string) =>
    errors.push({ code, position, message });

  if (tiers.length < MIN_TIERS || tiers.length > MAX_TIERS) {
    add('TIER_COUNT', null, `A product needs between ${MIN_TIERS} and ${MAX_TIERS} tiers.`);
  }

  tiers.forEach((tier, index) => {
    const position = index + 1;
    const previous = tiers[index - 1];

    if (!isPositiveInteger(tier.minQuantity)) {
      add(
        'MIN_QUANTITY_NOT_POSITIVE_INTEGER',
        position,
        `Tier ${position}'s minimum must be a whole number above zero.`,
      );
    } else if (
      previous !== undefined &&
      isPositiveInteger(previous.minQuantity) &&
      tier.minQuantity <= previous.minQuantity
    ) {
      add(
        'MIN_QUANTITY_NOT_INCREASING',
        position,
        `Tier ${position}'s minimum must be more than tier ${position - 1}'s.`,
      );
    }

    const priceIsValid = isPositiveInteger(tier.unitPriceSen);
    if (!priceIsValid) {
      add(
        'PRICE_NOT_POSITIVE_INTEGER',
        position,
        `Tier ${position}'s price must be a whole number of sen above zero.`,
      );
    } else if (
      previous !== undefined &&
      isPositiveInteger(previous.unitPriceSen) &&
      tier.unitPriceSen >= previous.unitPriceSen
    ) {
      add(
        'PRICE_NOT_DECREASING',
        position,
        `Tier ${position}'s price must be less than tier ${position - 1}'s.`,
      );
    }

    const buyAlone = opts.buyAlonePriceSen;
    if (priceIsValid && buyAlone !== undefined && tier.unitPriceSen >= buyAlone) {
      add(
        'PRICE_NOT_BELOW_BUY_ALONE',
        position,
        `Tier ${position}'s price must be below the buy-alone price.`,
      );
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** The highest 1-based tier whose minimum quantity the total reaches, or null if none is reached. */
export function tierForTotal(tiers: Tier[], total: number): number | null {
  let reached: number | null = null;
  tiers.forEach((tier, index) => {
    if (total >= tier.minQuantity) reached = index + 1;
  });
  return reached;
}
