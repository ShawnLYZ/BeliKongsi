export type PickupStatusView =
  'waiting' | 'ready' | 'out_for_delivery' | 'collected' | 'delivered' | 'checked' | 'closed';

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
  productName: string;
  unitName: string;
  quantity: number;
  /** The product picture, for the delivery check; `category` picks the icon without one. */
  category: string;
  imageUrl: string | null;
  imageAiGenerated: boolean;
}

/**
 * A shop's goods for one place and date, as owner and staff see them (stories 71, 99, 100). It
 * carries no money for anyone (R6). `pickupId` and `code` are null for goods not yet planned
 * into a pickup (their rounds are not hub-checked). Door delivery has no place name or hours.
 */
export interface PickupView {
  pickupId: string | null;
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
}
