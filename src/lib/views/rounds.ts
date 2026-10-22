import type { TierView } from './catalogue';

export interface RoundProgressView {
  totalQuantity: number;
  shopCount: number;
  currentTier: number | null;
  unitsToNextTier: number | null;
  nextTierUnitPriceSen: number | null;
}

export interface MyPriceView {
  destinationLabel: string;
  unitShippingSen: number;
  startingAllInSen: number;
  /** The all-in price at the round's current tier; null until the first tier is reached. */
  projectedAllInSen: number | null;
}

export interface OpenRoundView {
  roundId: string;
  productId: string;
  name: string;
  shortName: string;
  packDescription: string;
  unitName: string;
  imageUrl: string | null;
  imageAiGenerated: boolean;
  cutoffAt: string;
  tiers: TierView[];
  buyAlonePriceSen: number;
  progress: RoundProgressView;
  /** Owners only; null when the shop has no price at its destination. */
  myPrice: MyPriceView | null;
}

export interface StaffOpenRoundView {
  roundId: string;
  productId: string;
  name: string;
  shortName: string;
  packDescription: string;
  unitName: string;
  imageUrl: string | null;
  imageAiGenerated: boolean;
  cutoffAt: string;
}

export interface MyParticipationView {
  id: string;
  shopId: string;
  quantity: number;
  priceLimitSen: number | null;
  status: string;
  destinationType: string;
  pickupPointId: string | null;
  deliveryDate: string;
  joinedAt: string;
  unitShippingSen: number;
  startingAllInSen: number;
  paidSen: number;
}

export interface RoundDetailView {
  roundId: string;
  productId: string;
  name: string;
  shortName: string;
  packDescription: string;
  unitName: string;
  imageUrl: string | null;
  imageAiGenerated: boolean;
  status: string;
  cutoffAt: string;
  expectedReadyAt: string;
  tiers: TierView[];
  buyAlonePriceSen: number;
  progress: RoundProgressView;
  /** Owners: only this shop's rows. Everyone else: empty. Never another shop's name or quantity. */
  myParticipations: MyParticipationView[];
  /** When this round is no longer open: the cut-off of the product's next open round. */
  nextRoundCutoffAt: string | null;
  /** That next open round, to link to. */
  nextRoundId: string | null;
  /** Once a round has formed: its final tier and price, and how much was kept by how many shops. */
  result: RoundResultView | null;
}

export interface RoundResultView {
  /** 1-based tier position. */
  finalTier: number;
  /** Goods price per unit at the final tier. */
  finalUnitPriceSen: number;
  totalKept: number;
  /** Shops with kept lines. */
  shopCount: number;
  closedAt: string;
}

export interface StaffRoundDetailView {
  roundId: string;
  productId: string;
  name: string;
  shortName: string;
  packDescription: string;
  unitName: string;
  imageUrl: string | null;
  imageAiGenerated: boolean;
  status: string;
  cutoffAt: string;
  nextRoundCutoffAt: string | null;
  nextRoundId: string | null;
}
