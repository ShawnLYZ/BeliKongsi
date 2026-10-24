import type { TierView } from './catalogue';

/** What a supplier sees of an order: one consolidated quantity, never a shop. */
export interface SupplierOrderView {
  supplierOrderId: string;
  roundId: string;
  productName: string;
  packDescription: string;
  unitName: string;
  quantity: number;
  unitPriceSen: number;
  totalSen: number;
  hubName: string;
  requiredDispatchDate: string;
  expectedDispatchDate: string | null;
  status: string;
  approvalId: string | null;
}

export interface SupplierOpenRoundView {
  roundId: string;
  productName: string;
  /** The unit the round counts in, frozen when it opened. */
  unitName: string;
  cutoffAt: string;
  totalQuantity: number;
  shopCount: number;
  currentTier: number | null;
}

export interface SupplierProductView {
  productId: string;
  name: string;
  shortName: string;
  category: string;
  packDescription: string;
  unitName: string;
  unitWeightGrams: number;
  buyAlonePriceSen: number;
  tiers: TierView[];
  aliases: string[];
  /** Other ways a shop may count the unit, e.g. `{ tin: 48 }` for a carton of 48 tins. */
  packConversions: Record<string, number>;
  cadence: string;
  /** The ISO week the cadence counts from, e.g. "2026-W45". */
  scheduleAnchorWeek: string;
  cutoffWeekday: number;
  cutoffTime: string;
  active: boolean;
  /** The product's picture, or null when it has none (the category icon shows instead). */
  imageUrl: string | null;
  imageAiGenerated: boolean;
  /**
   * The cut-off of the round that a price change reaches first: the one after the open round,
   * or the one about to open when none is. Null when the product is not active (no new round).
   */
  nextRoundCutoffAt: string | null;
}

export interface SupplierPayoutView {
  supplierOrderId: string;
  productName: string;
  goodUnits: number;
  amountSen: number;
  reference: string;
  paidAt: string;
  simulated: true;
}

/** One price break as drafted from a price list or as the product has it now. */
export interface PriceListTierView {
  minQuantity: number;
  unitPriceSen: number;
}

/** A problem with a drafted line. Confirm stays disabled while any line has one. */
export interface PriceListLineError {
  /** A tier rule code (`PRICE_NOT_DECREASING`, ...) or `BUY_ALONE_NOT_WHOLE_SEN`. */
  code: string;
  /** 1-based tier position, or null when the error concerns the whole line. */
  position: number | null;
  message: string;
}

/** One product line the AI drafted from a price list. Nothing is saved until it is confirmed. */
export interface PriceListLineView {
  sourceText: string;
  /** One of this supplier's products, or null for a new-product draft. */
  productId: string | null;
  proposedName: string | null;
  packDescription: string | null;
  unitName: 'carton' | 'tin' | 'tray' | 'sack' | 'pack' | null;
  buyAlonePriceSen: number | null;
  tiers: PriceListTierView[];
  confidence: number;
  note: string | null;
  errors: PriceListLineError[];
  /** The matched product as it is now, to show next to the draft; null for a new product. */
  current: {
    name: string;
    packDescription: string;
    unitName: string;
    buyAlonePriceSen: number;
    tiers: PriceListTierView[];
  } | null;
}

export interface PriceListParseView {
  suggestionRunId: string;
  lines: PriceListLineView[];
  ignoredText: string[];
  model: string;
}
