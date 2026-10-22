import type { UnitAmounts } from './amounts';
import { EngineInputError, type FieldError } from './errors';
import type { Sen } from './types';
import { isIntegerInRange, isIsoInstant } from './validate';

export interface KeptForAllocation {
  id: string;
  quantity: number;
  joinedAt: string;
  final: UnitAmounts;
}

export interface AllocateShortfallInput {
  kept: KeptForAllocation[];
  goodUnitsReceived: number;
  finalGoodsPriceSen: Sen;
}

export interface AllocationResult {
  id: string;
  allocated: number;
  missing: number;
  refundSen: Sen;
}

export interface AllocateShortfallResult {
  allocations: AllocationResult[];
  orderedQuantity: number;
  receivedCounted: number;
  excessUnits: number;
  excessFlag: boolean;
  supplierPayableSen: Sen;
  feeRevenueSen: Sen;
  logisticsPayableSen: Sen;
  shortfallRefundSen: Sen;
}

const WHOLE_SEN = 'This must be a whole number of sen, zero or more.';

function validate(input: AllocateShortfallInput): void {
  const fields: FieldError[] = [];
  const { kept, goodUnitsReceived, finalGoodsPriceSen } = input;

  if (!isIntegerInRange(goodUnitsReceived, 0)) {
    fields.push({
      path: 'goodUnitsReceived',
      message: 'The units received must be a whole number, zero or more.',
    });
  }
  const priceValid = isIntegerInRange(finalGoodsPriceSen, 0);
  if (!priceValid) fields.push({ path: 'finalGoodsPriceSen', message: WHOLE_SEN });

  const seen = new Set<string>();
  kept.forEach((x, i) => {
    const at = `kept[${i}]`;
    if (typeof x.id !== 'string' || x.id === '') {
      fields.push({ path: `${at}.id`, message: 'The id must be a non-empty string.' });
    } else if (seen.has(x.id)) {
      fields.push({ path: `${at}.id`, message: `The id "${x.id}" is used more than once.` });
    } else {
      seen.add(x.id);
    }
    if (!isIntegerInRange(x.quantity, 1)) {
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
    const f = x.final;
    const parts = [f.goodsSen, f.feeSen, f.shippingSen, f.allInSen];
    const names = ['goodsSen', 'feeSen', 'shippingSen', 'allInSen'] as const;
    let partsValid = true;
    parts.forEach((value, j) => {
      if (!isIntegerInRange(value, 0)) {
        partsValid = false;
        fields.push({ path: `${at}.final.${names[j]}`, message: WHOLE_SEN });
      }
    });
    if (partsValid) {
      if (priceValid && f.goodsSen !== finalGoodsPriceSen) {
        fields.push({
          path: `${at}.final.goodsSen`,
          message: `The goods price must equal the final price: ${finalGoodsPriceSen} sen.`,
        });
      }
      if (f.allInSen !== f.goodsSen + f.feeSen + f.shippingSen) {
        fields.push({
          path: `${at}.final.allInSen`,
          message: 'The all-in amount must equal goods plus fee plus shipping.',
        });
      }
    }
  });

  if (fields.length > 0) throw new EngineInputError(fields);
}

/** Gives the good units received to kept participations first come, first served (PRD §6.7). */
export function allocateShortfall(input: AllocateShortfallInput): AllocateShortfallResult {
  validate(input);
  const { goodUnitsReceived, finalGoodsPriceSen } = input;

  const ordered = [...input.kept].sort((a, b) => {
    const byTime = Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const orderedQuantity = ordered.reduce((sum, x) => sum + x.quantity, 0);
  const receivedCounted = Math.min(goodUnitsReceived, orderedQuantity);
  const excessUnits = Math.max(0, goodUnitsReceived - orderedQuantity);

  let left = receivedCounted;
  let feeRevenueSen = 0;
  let logisticsPayableSen = 0;
  let shortfallRefundSen = 0;
  const allocations = ordered.map((x): AllocationResult => {
    const allocated = Math.min(x.quantity, left);
    left -= allocated;
    const missing = x.quantity - allocated;
    const refundSen = missing * x.final.allInSen;
    feeRevenueSen += allocated * x.final.feeSen;
    logisticsPayableSen += allocated * x.final.shippingSen;
    shortfallRefundSen += refundSen;
    return { id: x.id, allocated, missing, refundSen };
  });

  return {
    allocations,
    orderedQuantity,
    receivedCounted,
    excessUnits,
    excessFlag: excessUnits > 0,
    supplierPayableSen: receivedCounted * finalGoodsPriceSen,
    feeRevenueSen,
    logisticsPayableSen,
    shortfallRefundSen,
  };
}
