// Words for Ops screens: the ledger and order states in short, plain labels.

const POSTING_KINDS: Record<string, string> = {
  payment_in: 'Payments in',
  balance_applied: 'Balance used',
  delivery_fee_in: 'Delivery fees in',
  refund_cancelled: 'Refunds: line cancelled',
  refund_difference: 'Refunds: price difference',
  refund_dropped: 'Refunds: above price limit',
  refund_failed: 'Refunds: round did not go ahead',
  refund_round_cancelled: 'Refunds: round cancelled',
  refund_shortfall: 'Refunds: delivered short',
  refund_delivery_fee: 'Refunds: delivery fee',
  settlement_supplier: 'Settled to supplier payable',
  settlement_fee: 'Settled to fee revenue',
  settlement_logistics: 'Settled to logistics payable',
  supplier_payout: 'Supplier payouts (Simulated)',
  delivery_fee_to_partner: 'Delivery fees to the partner',
  refund_claim: 'Refunds: claims',
};

export function postingKindLabel(kind: string): string {
  return POSTING_KINDS[kind] ?? kind.replace(/_/g, ' ');
}

const ORDER_STATUSES: Record<string, string> = {
  awaiting_ops: 'Waiting for Ops approval',
  awaiting_supplier: 'Waiting for the supplier',
  confirmed: 'Confirmed by the supplier',
  dispatched: 'Dispatched, waiting for the hub check',
  settled: 'Hub-checked and paid (Simulated)',
  rejected_by_ops: 'Rejected by Ops',
  rejected_by_supplier: 'Rejected by the supplier',
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUSES[status] ?? status.replace(/_/g, ' ');
}

/** 0.909 -> "91%" */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Shared table styles for Ops screens (laptop-first, 16 px text). */
export const TABLE_WRAP = 'bg-card overflow-x-auto rounded-2xl border';
export const TABLE = 'w-full border-collapse text-left text-base';
export const TH = 'px-4 py-3 font-semibold whitespace-nowrap';
export const TH_NUM = 'px-4 py-3 text-right font-semibold whitespace-nowrap';
export const TD = 'px-4 py-3 align-top';
export const TD_NUM = 'px-4 py-3 text-right align-top whitespace-nowrap tabular-nums';
export const LINK =
  'text-primary font-semibold underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring/60 rounded-sm';
