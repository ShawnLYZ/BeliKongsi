import { unitAmounts, type UnitAmounts } from './amounts';
import { EngineInputError, tierFieldErrors, type FieldError } from './errors';
import { explainOutcome } from './explain';
import { tierForTotal, validateTiers } from './tiers';
import type { Sen, Tier } from './types';
import { isIntegerInRange, isIsoInstant } from './validate';

export interface CloseParticipant {
  id: string;
  quantity: number;
  joinedAt: string;
  unitShippingSen: Sen;
  priceLimitSen: Sen | null;
  paidSen: Sen;
}

export interface CloseRoundInput {
  tiers: Tier[];
  feeBps: number;
  participants: CloseParticipant[];
  unitName?: string;
}

export type CloseOutcome = 'kept' | 'dropped_price_limit' | 'refunded_failed';

export interface CloseParticipantResult {
  id: string;
  outcome: CloseOutcome;
  final: UnitAmounts | null;
  finalLineSen: Sen;
  refundSen: Sen;
  reason: string;
}

export interface CloseRoundResult {
  status: 'empty' | 'failed' | 'formed';
  finalTier: number | null;
  finalUnitPriceSen: Sen | null;
  iterations: number;
  totalAtCutoff: number;
  totalKept: number;
  participants: CloseParticipantResult[];
  totals: { paidSen: Sen; refundSen: Sen; keptSen: Sen };
}

const isInt = (value: unknown): value is number =>
  isIntegerInRange(value, -Number.MAX_SAFE_INTEGER);
const isPositiveInt = (value: unknown): value is number => isIntegerInRange(value, 1);

function validate(input: CloseRoundInput): void {
  const fields: FieldError[] = [];
  const { tiers, feeBps, participants } = input;

  const tierCheck = validateTiers(tiers);
  if (!tierCheck.ok) fields.push(...tierFieldErrors(tierCheck.errors));

  const feeValid = isInt(feeBps) && feeBps >= 0 && feeBps <= 10_000;
  if (!feeValid)
    fields.push({ path: 'feeBps', message: 'The fee must be 0 to 10000 basis points.' });

  const seen = new Set<string>();
  participants.forEach((x, i) => {
    const at = `participants[${i}]`;
    if (typeof x.id !== 'string' || x.id === '') {
      fields.push({ path: `${at}.id`, message: 'The id must be a non-empty string.' });
    } else if (seen.has(x.id)) {
      fields.push({ path: `${at}.id`, message: `The id "${x.id}" is used more than once.` });
    } else {
      seen.add(x.id);
    }
    const quantityValid = isPositiveInt(x.quantity);
    if (!quantityValid) {
      fields.push({
        path: `${at}.quantity`,
        message: 'The quantity must be a whole number above zero.',
      });
    }
    if (!isIsoInstant(x.joinedAt)) {
      fields.push({
        path: `${at}.joinedAt`,
        message:
          'The join time must be an ISO date-time with Z or a UTC offset, such as 2026-11-01T10:00:00Z.',
      });
    }
    const shippingValid = isInt(x.unitShippingSen) && x.unitShippingSen >= 0;
    if (!shippingValid) {
      fields.push({
        path: `${at}.unitShippingSen`,
        message: 'Shipping must be a whole number of sen, zero or more.',
      });
    }
    if (x.priceLimitSen !== null && !isPositiveInt(x.priceLimitSen)) {
      fields.push({
        path: `${at}.priceLimitSen`,
        message: 'The price limit must be empty or a whole number of sen above zero.',
      });
    }
    if (tierCheck.ok && feeValid && quantityValid && shippingValid) {
      const starting = unitAmounts(tiers[0]!.unitPriceSen, feeBps, x.unitShippingSen).allInSen;
      if (x.paidSen !== starting * x.quantity) {
        fields.push({
          path: `${at}.paidSen`,
          message: `The amount paid must equal the starting price: ${starting * x.quantity} sen.`,
        });
      }
    }
  });

  if (fields.length > 0) throw new EngineInputError(fields);
}

/** Closes a round: drops price-limit participations until the round settles (PRD §6.6). */
export function closeRound(input: CloseRoundInput): CloseRoundResult {
  validate(input);
  const { tiers, feeBps, participants } = input;
  const unitName = input.unitName ?? 'unit';
  const minQuantity = tiers[0]!.minQuantity;

  const droppedAt = new Map<string, UnitAmounts>();
  let remaining = participants;
  let iterations = 0;
  let tier: number | null = null;
  const totalAtCutoff = participants.reduce((sum, x) => sum + x.quantity, 0);

  while (remaining.length > 0) {
    iterations += 1;
    const total = remaining.reduce((sum, x) => sum + x.quantity, 0);
    tier = tierForTotal(tiers, total);
    if (tier === null) break;
    const goods = tiers[tier - 1]!.unitPriceSen;
    const dropped = remaining.filter(
      (x) =>
        x.priceLimitSen !== null &&
        x.priceLimitSen < unitAmounts(goods, feeBps, x.unitShippingSen).allInSen,
    );
    if (dropped.length === 0) break;
    for (const x of dropped) droppedAt.set(x.id, unitAmounts(goods, feeBps, x.unitShippingSen));
    remaining = remaining.filter((x) => !droppedAt.has(x.id));
  }

  const status: CloseRoundResult['status'] =
    participants.length === 0
      ? 'empty'
      : tier === null || remaining.length === 0
        ? 'failed'
        : 'formed';
  const finalTier = status === 'formed' ? tier : null;
  const finalGoods = finalTier === null ? null : tiers[finalTier - 1]!.unitPriceSen;

  const results = participants.map((x): CloseParticipantResult => {
    const dropAmounts = droppedAt.get(x.id);
    let partial: Omit<CloseParticipantResult, 'reason'>;
    if (dropAmounts !== undefined) {
      partial = {
        id: x.id,
        outcome: 'dropped_price_limit',
        final: dropAmounts,
        finalLineSen: 0,
        refundSen: x.paidSen,
      };
    } else if (finalGoods === null) {
      partial = {
        id: x.id,
        outcome: 'refunded_failed',
        final: null,
        finalLineSen: 0,
        refundSen: x.paidSen,
      };
    } else {
      const final = unitAmounts(finalGoods, feeBps, x.unitShippingSen);
      const line = final.allInSen * x.quantity;
      partial = {
        id: x.id,
        outcome: 'kept',
        final,
        finalLineSen: line,
        refundSen: x.paidSen - line,
      };
    }
    const reason = explainOutcome(
      { ...partial, reason: '' },
      { finalTier, minQuantity, unitName, priceLimitSen: x.priceLimitSen },
    );
    return { ...partial, reason };
  });

  const sum = (pick: (r: CloseParticipantResult, x: CloseParticipant) => number) =>
    results.reduce((total, r, i) => total + pick(r, participants[i]!), 0);

  return {
    status,
    finalTier,
    finalUnitPriceSen: finalGoods,
    iterations,
    totalAtCutoff,
    totalKept: sum((r, x) => (r.outcome === 'kept' ? x.quantity : 0)),
    participants: results,
    totals: {
      paidSen: sum((_, x) => x.paidSen),
      refundSen: sum((r) => r.refundSen),
      keptSen: sum((r) => r.finalLineSen),
    },
  };
}
