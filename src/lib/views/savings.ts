/** What one Kongsi line saved the shop. Amounts are in sen and can be negative (PRD §6.10). */
export interface SavingsView {
  savingSen: number;
  unitSavingSen: number;
  /** "estimated" until the delivery check, then "verified". */
  status: 'estimated' | 'verified';
  /** "buy_alone" means there was no usual price: the baseline is only an estimate. */
  basis: 'usual_price' | 'buy_alone';
}

/** The delivery check's result for one line, in units. */
export interface DeliveryResultView {
  received: number;
  missing: number;
  damaged: number;
}

export interface MonthlySavingsItemView {
  participationId: string;
  productName: string;
  status: SavingsView['status'];
  basis: SavingsView['basis'];
  savingSen: number;
}

/** One calendar month in Malaysia time, as the owner's savings screen shows it. */
export interface MonthlySavingsView {
  /** `YYYY-MM`. */
  month: string;
  roundsJoined: number;
  unitsBought: number;
  refundsSen: number;
  feesPaidSen: number;
  deliveryFeesSen: number;
  /** Verified savings of checks submitted in the month, less the delivery fees. */
  verifiedSavingsSen: number;
  /** Savings of kept lines from rounds closed in the month that are not checked yet. */
  estimatedSavingsSen: number;
  /** Verified savings against usual prices, as a percentage with one decimal; null with none. */
  percentSaved: number | null;
  items: MonthlySavingsItemView[];
}
