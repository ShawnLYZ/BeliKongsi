export type PaymentStatusView = 'pending' | 'succeeded' | 'failed' | 'voided';
export type PaymentMethodView = 'duitnow_qr' | 'fpx' | 'balance_only';

/** What approving a basket or joining a round returns: the amounts and where to pay. */
export interface PaymentSummary {
  paymentId: string;
  status: 'pending' | 'succeeded';
  linesTotalSen: number;
  deliveryFeeSen: number;
  totalSen: number;
  balanceAppliedSen: number;
  externalSen: number;
  /** The simulated checkout while money is still to be paid outside the balance; otherwise null. */
  checkoutUrl: string | null;
}

/** A payment as its shop's owner sees it. */
export interface PaymentView extends Omit<PaymentSummary, 'status'> {
  status: PaymentStatusView;
  method: PaymentMethodView | null;
  partnerReference: string | null;
  purpose: 'basket' | 'join';
  basketId: string | null;
  shopId: string;
  /** ISO instant; a result after it voids the payment. */
  deadlineAt: string;
}

/** A succeeded payment's receipt. All amounts are in sen. */
export interface ReceiptView {
  paymentId: string;
  /** ISO instant the payment succeeded. */
  issuedAt: string;
  shopName: string;
  lines: {
    productName: string;
    quantity: number;
    unitAllInSen: number;
    unitGoodsSen: number;
    unitFeeSen: number;
    unitShippingSen: number;
    lineSen: number;
  }[];
  deliveryFeeSen: number;
  balanceAppliedSen: number;
  /** Paid outside the balance (the simulated partner). */
  paidSen: number;
  totalSen: number;
  method: PaymentMethodView;
  partnerReference: string | null;
  notice: 'Issued by BeliKongsi (simulated). Not a tax invoice.';
}

export type MoneyHistoryKind = 'payment' | 'balance_used' | 'refund' | 'claim_refund';

/** One line of a shop's money history. `runningBalanceSen` is the shop balance after the item. */
export interface MoneyHistoryItem {
  /** ISO instant. */
  at: string;
  kind: MoneyHistoryKind;
  label: string;
  /** The size of the money movement, always positive. */
  amountSen: number;
  /** Signed effect on the balance: refunds are positive, balance used is negative, payments are 0. */
  balanceChangeSen: number;
  runningBalanceSen: number;
  reason: string | null;
}

export interface BalanceView {
  balanceSen: number;
  history: { items: MoneyHistoryItem[]; nextCursor: string | null };
}
