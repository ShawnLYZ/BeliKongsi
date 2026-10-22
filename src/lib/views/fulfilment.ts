export type ConsignmentStatusView =
  'planned' | 'dispatched' | 'arrived' | 'out_for_delivery' | 'delivered' | 'completed';

export interface LatLng {
  lat: number;
  lng: number;
}

/** One `statusHistory` entry: who is an id (or the system), never a name. */
export interface ConsignmentHistoryEntry {
  status: ConsignmentStatusView;
  at: string;
  actor: { type: 'person'; userId: string } | { type: 'system' };
}

/** One row on the Ops consignments board, with what the network map needs. */
export interface ConsignmentView {
  consignmentId: string;
  hubName: string;
  hubLatLng: LatLng;
  destinationType: 'pickup_point' | 'door';
  destinationName: string;
  destinationLatLng: LatLng;
  deliveryDate: string;
  wave: number;
  status: ConsignmentStatusView;
  statusHistory: ConsignmentHistoryEntry[];
  /** Units allocated to the consignment, across all its lines. */
  itemCount: number;
  containsFeaturedRound: boolean;
  partnerReference: string;
}
