export interface TierView {
  position: number;
  minQuantity: number;
  unitPriceSen: number;
}

export interface CatalogueItemView {
  productId: string;
  name: string;
  shortName: string;
  packDescription: string;
  unitName: string;
  category: string;
  supplierName: string;
  imageUrl: string | null;
  imageAiGenerated: boolean;
  buyAlonePriceSen: number;
  tiers: TierView[];
  openRound: {
    roundId: string;
    cutoffAt: string;
    totalQuantity: number;
    shopCount: number;
    currentTier: number | null;
  } | null;
}

/** What staff see: names and pictures, no money (R6). */
export interface StaffCatalogueItemView {
  productId: string;
  name: string;
  shortName: string;
  packDescription: string;
  unitName: string;
  category: string;
  imageUrl: string | null;
  imageAiGenerated: boolean;
}
