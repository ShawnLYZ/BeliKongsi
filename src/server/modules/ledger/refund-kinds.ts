/** The postings that give money back to the shop for one line (not the delivery fee, not claims). */
export const REFUND_KINDS = [
  'refund_cancelled',
  'refund_difference',
  'refund_dropped',
  'refund_failed',
  'refund_round_cancelled',
  'refund_shortfall',
] as const;
