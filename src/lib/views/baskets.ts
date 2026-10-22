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
  savingsBasis: 'usual_price' | 'buy_alone';
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
