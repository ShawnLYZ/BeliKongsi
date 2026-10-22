import type { PartnerStatus } from '@/lib/consignment-steps';
import type { ConsignmentStatusView } from '@/lib/views/fulfilment';

/** Board columns, in the order goods move. */
export const CONSIGNMENT_STATUSES: readonly ConsignmentStatusView[] = [
  'planned',
  'dispatched',
  'arrived',
  'out_for_delivery',
  'delivered',
  'completed',
];

const WORDS: Record<ConsignmentStatusView, string> = {
  planned: 'Planned',
  dispatched: 'Dispatched',
  arrived: 'Arrived at pickup point',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  completed: 'Completed',
};

export const consignmentStatusWords = (s: ConsignmentStatusView): string => WORDS[s];

const ACTIONS: Record<PartnerStatus, string> = {
  dispatched: 'Mark dispatched',
  arrived: 'Mark arrived',
  out_for_delivery: 'Mark out for delivery',
  delivered: 'Mark delivered',
};

export const stepActionLabel = (s: PartnerStatus): string => ACTIONS[s];

/** Map and legend colours per status (WCAG AA against white for lines and pins). */
export const STATUS_COLOURS: Record<ConsignmentStatusView, string> = {
  planned: '#57534e',
  dispatched: '#b45309',
  arrived: '#0f766e',
  out_for_delivery: '#1d4ed8',
  delivered: '#15803d',
  completed: '#6d28d9',
};

/**
 * The toast after a partner step, from the status the server returned: an "arrived" or
 * "delivered" move whose pickups were all collected already (background shops) comes back
 * `completed`, and says so.
 */
export function consignmentMovedMessage(
  c: { hubName: string; destinationName: string },
  requested: PartnerStatus,
  returned: ConsignmentStatusView,
): string {
  const route = `${c.hubName} → ${c.destinationName}`;
  if (returned === 'completed') {
    return `${route}: ${requested.replace(/_/g, ' ')} — all pickups collected, consignment completed.`;
  }
  return `${route}: ${consignmentStatusWords(returned).toLowerCase()}.`;
}
