export type PickupStatusView =
  | 'waiting'
  | 'ready'
  | 'partly_ready'
  | 'out_for_delivery'
  | 'collected'
  | 'delivered'
  | 'checked'
  | 'closed';

/** How owners and staff read where their goods are (story 71). */
export type PickupStatusLabel =
  | 'Waiting for supplier'
  | 'On its way to the hub'
  | 'At the hub'
  | 'On the way'
  | 'Ready for pickup'
  | 'Collected'
  | 'Out for delivery'
  | 'Delivered';

/** One product in a pickup. `allocationId` is null while the goods are not hub-checked yet. */
export interface PickupLineView {
  allocationId: string | null;
  /** The shop's order line this is, for "Cancel late item" (owner only; an id, no money). */
  participationId: string;
  /**
   * True when the pickup code hands these goods over now (the same rule as the hand-over); false
   * while they are on the way, held back for the rest, or already collected.
   */
  readyToCollect: boolean;
  productName: string;
  unitName: string;
  quantity: number;
  /** The product picture, for the delivery check; `category` picks the icon without one. */
  category: string;
  imageUrl: string | null;
  imageAiGenerated: boolean;
}

/** One hand-over of a pickup's goods (P1-8): what was taken, when, and whether it was checked. */
export interface PickupCollectionView {
  collectionId: string;
  /** ISO time. */
  collectedAt: string;
  checked: boolean;
  /** What the check said; `not_checked` means the 72-hour window closed first. Null until checked. */
  checkResult: 'all_received' | 'issues' | 'not_checked' | null;
  /** The claim opened by this collection's check, if it reported a problem. */
  claimId: string | null;
  lines: PickupLineView[];
}

/** A late pickup (P1-7): when it was due, the new date Ops set, and when an item can be cancelled. */
export interface PickupLateView {
  /** ISO time the goods were first due. */
  originalExpectedAt: string;
  /** ISO time of the new date Ops set, if any. */
  newExpectedAt: string | null;
  /** Why Ops set the new date, if they did. */
  reason: string | null;
  /** ISO time from which the owner can cancel a late item (72 hours after the original time). */
  cancelFrom: string;
  /** True once `cancelFrom` has passed. */
  canCancelNow: boolean;
}

/**
 * A shop's goods for one place and date, as owner and staff see them (stories 71, 99, 100). It
 * carries no money for anyone (R6). `pickupId` and `code` are null for goods not yet planned
 * into a pickup (their rounds are not hub-checked). Door delivery has no place name or hours.
 */
export interface PickupView {
  pickupId: string | null;
  /**
   * For goods not yet planned into a pickup, the key of their group (`<date>.<pickup point id>` or
   * `<date>.door`), which names the owner's page for it; null for a pickup.
   */
  groupKey: string | null;
  destinationType: 'pickup_point' | 'door';
  placeName: string | null;
  address: string | null;
  openingHours: string | null;
  /** `YYYY-MM-DD`. */
  deliveryDate: string;
  status: PickupStatusView;
  statusLabel: PickupStatusLabel;
  code: string | null;
  /** The claim opened by this pickup's delivery check, if it reported a problem. */
  claimId: string | null;
  lines: PickupLineView[];
  /** Each hand-over so far, oldest first; one check is due per collection (O7). */
  collections: PickupCollectionView[];
  /** Set while goods are late: not ready, or only partly ready, past the expected time. */
  late: PickupLateView | null;
}
