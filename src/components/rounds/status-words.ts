// Plain English for round and participation statuses (PRD §22: no logistics jargon).
const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Not open yet',
  open: 'Open',
  empty: 'Closed with no orders',
  failed: 'Did not go ahead',
  formed: 'Going ahead',
  ordered: 'Ordered from the supplier',
  confirmed: 'Confirmed by the supplier',
  dispatched: 'On the way',
  at_hub: 'At the hub',
  completed: 'Completed',
  cancelled: 'Cancelled',
  active: 'Waiting for cut-off',
  dropped_price_limit: 'Left out: the price went above your limit',
  refunded_failed: 'Refunded: the round did not go ahead',
  kept: 'Going ahead',
  refunded_round_cancelled: 'Refunded: the round was cancelled',
  allocated: 'Your goods are set aside',
  shorted: 'Fewer goods than ordered',
  received: 'Received',
  closed: 'Closed',
};

export function statusWords(code: string): string {
  return STATUS_LABELS[code] ?? code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** R11: a round past its cut-off that the close job hasn't reached yet. */
export const CLOSING_TEXT = 'Closing…';

/** True when an open round's cut-off has passed by the app's clock (not the device's). */
export function isClosing(cutoffAt: string, serverNow: string): boolean {
  return Date.parse(serverNow) >= Date.parse(cutoffAt);
}
