import type { Role } from '@/generated/prisma/client';
import type { PickupPointView } from './directory';

export type BasketStatusView = 'draft' | 'payment_pending' | 'paid' | 'skipped' | 'expired';

export interface BasketTotalsView {
  itemsAtStartingSen: number;
  feeIncludedSen: number;
  deliveryFeeSen: number;
  totalNowSen: number;
  balanceAvailableSen: number;
  balanceAppliedSen: number;
  payNowSen: number;
  estimatedAfterCutoffSen: number;
  estimatedSavingsSen: number;
  savingsHasBuyAloneBasis: boolean;
}

/** What a paid basket came to once every one of its rounds had closed (after the cut-off). */
export interface BasketSettledView {
  /** The goods paid for; the door delivery fee is not in it. */
  paidSen: number;
  /** What the kept lines cost at the final price. */
  finalSen: number;
  /** Paid minus final: the price difference, any dropped lines and any hub shortfall, back in the balance. */
  refundedSen: number;
  /**
   * Against the usual price (or buying alone), as the Savings page shows it. Despite the name it
   * holds the verified figure once the delivery check is in; `savingsStatus` says which.
   */
  estimatedSavingsSen: number;
  savingsStatus: 'estimated' | 'verified';
  savingsHasBuyAloneBasis: boolean;
}

export interface OwnerBasketLine {
  lineId: string;
  productId: string;
  name: string;
  shortName: string;
  packDescription: string;
  unitName: string;
  imageUrl: string | null;
  quantity: number;
  priceLimitSen: number | null;
  usualPriceSen: number | null;
  source: 'usual_list' | 'staff' | 'owner';
  changedBy: { name: string; role: Role } | null;
  staffAddedQuantity: number;
  removed: boolean;
  notice: string | null;
  roundId: string | null;
  cutoffAt: string | null;
  /** Null while the line has no round yet (staff additions waiting for drafting). */
  startingAllInSen: number | null;
  startingLineSen: number | null;
  /** Null when the round would not reach its minimum with this line. */
  projectedAllInSen: number | null;
  estimatedSavingsSen: number | null;
  /** Whether `estimatedSavingsSen` is still an estimate or verified by the delivery check. */
  savingsStatus: 'estimated' | 'verified';
  savingsBasis: 'usual_price' | 'buy_alone';
  /** True once the line's round has closed: `projectedAllInSen` is then the final price (null if dropped). */
  closed: boolean;
  explanation: string[];
}

export interface OwnerBasketView {
  basketId: string;
  week: string;
  status: BasketStatusView;
  deadlineAt: string;
  fulfilment: 'pickup' | 'door';
  pickupPoint: PickupPointView | null;
  lines: OwnerBasketLine[];
  totals: BasketTotalsView;
  /** Set once the paid basket's rounds have all closed; the open-round `totals` are then zero. */
  settled: BasketSettledView | null;
  approvalRequestId: string | null;
  /** The basket's pending or succeeded payment (the checkout to return to, or the receipt). */
  paymentId: string | null;
}

/** What staff see: quantities only, no money (R6). */
export interface StaffBasketView {
  basketId: string;
  week: string;
  status: BasketStatusView;
  lines: {
    lineId: string;
    productId: string;
    name: string;
    packDescription: string;
    unitName: string;
    imageUrl: string | null;
    quantity: number;
    waitingForOwner: boolean;
    addedByMe: boolean;
  }[];
}
