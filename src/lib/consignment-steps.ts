import type { ConsignmentStatusView } from '@/lib/views/fulfilment';

/** The statuses the logistics partner (or Ops for it) can move a consignment to. */
export type PartnerStatus = 'dispatched' | 'arrived' | 'out_for_delivery' | 'delivered';

/**
 * The partner's steps (PRD §10): one shared first step, then the pickup-point or door path.
 * Pure, so the server's transition check and the Ops board's buttons share one table.
 */
const NEXT: Record<
  'pickup_point' | 'door',
  Partial<Record<ConsignmentStatusView, PartnerStatus>>
> = {
  pickup_point: { planned: 'dispatched', dispatched: 'arrived' },
  door: { planned: 'dispatched', dispatched: 'out_for_delivery', out_for_delivery: 'delivered' },
};

/** The one allowed next status for a consignment, or null when the partner has no step left. */
export function nextConsignmentStep(
  destinationType: 'pickup_point' | 'door',
  status: ConsignmentStatusView,
): PartnerStatus | null {
  return NEXT[destinationType][status] ?? null;
}
