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
  cutoffAt: string;
  totalQuantity: number;
  shopCount: number;
  currentTier: number | null;
}

export interface SupplierProductView {
  productId: string;
  name: string;
  packDescription: string;
  unitName: string;
  buyAlonePriceSen: number;
  tiers: TierView[];
  cadence: string;
  cutoffWeekday: number;
  cutoffTime: string;
  active: boolean;
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
