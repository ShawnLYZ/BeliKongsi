import { unitAmounts } from './amounts';
import type { UnitAmounts } from './amounts';
import { EngineInputError, tierFieldErrors } from './errors';
import type { FieldError } from './errors';
import { explainQuote } from './explain';
import { tierForTotal, validateTiers } from './tiers';
import type { Sen, Tier } from './types';
import { isIntegerInRange } from './validate';

export interface QuoteInput {
  tiers: Tier[];
  feeBps: number;
  unitShippingSen: Sen;
  /** The caller's quantity, at least 1. */
  quantity: number;
  /** Units already in the round, not counting `quantity`. */
  currentRoundTotal: number;
  priceLimitSen?: Sen | null;
  /** 'carton', 'tray', … (for sentences). */
  unitName: string;
}

export interface TierView {
  position: number;
  minQuantity: number;
  unitPriceSen: Sen;
}

export interface Projection {
  total: number;
  tier: number | null;
  amounts: UnitAmounts | null;
  unitsToNextTier: number | null;
  nextTier: TierView | null;
}

export interface QuoteResult {
  starting: UnitAmounts;
  startingLineSen: Sen;
  withoutYou: Projection;
  withYou: Projection;
  limit: null | {
    priceLimitSen: Sen;
    belowStarting: boolean;
    lowestTierMeetingLimit: (TierView & { allInSen: Sen }) | null;
  };
  explanation: string[];
}

function validateQuoteInput(input: QuoteInput): FieldError[] {
  const fields: FieldError[] = [];
  if (!Array.isArray(input.tiers)) {
    fields.push({ path: 'tiers', message: 'Tiers must be a list.' });
  } else {
    const result = validateTiers(input.tiers);
    if (!result.ok) fields.push(...tierFieldErrors(result.errors));
  }
  if (!isIntegerInRange(input.feeBps, 0, 10_000)) {
    fields.push({ path: 'feeBps', message: 'The fee must be a whole number from 0 to 10000.' });
  }
  if (!isIntegerInRange(input.unitShippingSen, 0)) {
    fields.push({
      path: 'unitShippingSen',
      message: 'Shipping must be a whole number of sen, zero or more.',
    });
  }
  if (!isIntegerInRange(input.quantity, 1)) {
    fields.push({ path: 'quantity', message: 'Quantity must be a whole number, 1 or more.' });
  }
  if (!isIntegerInRange(input.currentRoundTotal, 0)) {
    fields.push({
      path: 'currentRoundTotal',
      message: 'The round total must be a whole number, zero or more.',
    });
  }
  if (input.priceLimitSen !== undefined && input.priceLimitSen !== null) {
    if (!isIntegerInRange(input.priceLimitSen, 1)) {
      fields.push({
        path: 'priceLimitSen',
        message: 'The price limit must be a whole number of sen above zero.',
      });
    }
  }
  if (typeof input.unitName !== 'string' || input.unitName.trim() === '') {
    fields.push({ path: 'unitName', message: 'The unit name must not be empty.' });
  }
  return fields;
}

function project(input: QuoteInput, total: number): Projection {
  const { tiers, feeBps, unitShippingSen } = input;
  const tier = tierForTotal(tiers, total);
  const nextIndex = tier === null ? 0 : tier;
  const next = tiers[nextIndex];
  const nextTier: TierView | null =
    next === undefined
      ? null
      : { position: nextIndex + 1, minQuantity: next.minQuantity, unitPriceSen: next.unitPriceSen };
  const reached = tier === null ? undefined : tiers[tier - 1];
  return {
    total,
    tier,
    amounts:
      reached === undefined ? null : unitAmounts(reached.unitPriceSen, feeBps, unitShippingSen),
    unitsToNextTier: nextTier === null ? null : nextTier.minQuantity - total,
    nextTier,
  };
}

/** Quotes one line: the starting price, the round with and without the caller, and the price limit. */
export function quote(input: QuoteInput): QuoteResult {
  const fields = validateQuoteInput(input);
  if (fields.length > 0) throw new EngineInputError(fields);

  const { tiers, feeBps, unitShippingSen, quantity, currentRoundTotal, unitName } = input;
  const first = tiers[0] as Tier;
  const starting = unitAmounts(first.unitPriceSen, feeBps, unitShippingSen);

  let limit: QuoteResult['limit'] = null;
  if (input.priceLimitSen !== undefined && input.priceLimitSen !== null) {
    const priceLimitSen = input.priceLimitSen;
    let lowest: (TierView & { allInSen: Sen }) | null = null;
    for (let index = 0; index < tiers.length && lowest === null; index += 1) {
      const tier = tiers[index] as Tier;
      const allInSen = unitAmounts(tier.unitPriceSen, feeBps, unitShippingSen).allInSen;
      if (allInSen <= priceLimitSen) {
        lowest = {
          position: index + 1,
          minQuantity: tier.minQuantity,
          unitPriceSen: tier.unitPriceSen,
          allInSen,
        };
      }
    }
    limit = {
      priceLimitSen,
      belowStarting: priceLimitSen < starting.allInSen,
      lowestTierMeetingLimit: lowest,
    };
  }

  const result: QuoteResult = {
    starting,
    startingLineSen: starting.allInSen * quantity,
    withoutYou: project(input, currentRoundTotal),
    withYou: project(input, currentRoundTotal + quantity),
    limit,
    explanation: [],
  };
  result.explanation = explainQuote(result, quantity, unitName);
  return result;
}
