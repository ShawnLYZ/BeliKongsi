import { unitAmounts, type Tier } from '@/server/engine';

export const FEE_BPS = 200;

export const SHIP_CM_IPOH = 293;
export const SHIP_CM_JB = 429;
export const SHIP_CM_PJ = 156;
export const SHIP_EGG_KUANTAN = 40;

export const CM_TIERS: Tier[] = [
  { minQuantity: 20, unitPriceSen: 15800 },
  { minQuantity: 50, unitPriceSen: 15200 },
  { minQuantity: 100, unitPriceSen: 14600 },
];

export const EGG_B_TIERS: Tier[] = [
  { minQuantity: 100, unitPriceSen: 1170 },
  { minQuantity: 300, unitPriceSen: 1130 },
  { minQuantity: 600, unitPriceSen: 1090 },
];

export interface FixtureParticipant {
  id: string;
  quantity: number;
  joinedAt: string;
  unitShippingSen: number;
  priceLimitSen: number | null;
  paidSen: number;
}

function startingAllIn(tiers: Tier[], shipping: number): number {
  return unitAmounts(tiers[0]!.unitPriceSen, FEE_BPS, shipping).allInSen;
}

function fixtureParticipant(
  tiers: Tier[],
  id: string,
  quantity: number,
  shipping: number,
  joinedAt: string,
  priceLimitSen: number | null = null,
): FixtureParticipant {
  return {
    id,
    quantity,
    joinedAt,
    unitShippingSen: shipping,
    priceLimitSen,
    paidSen: startingAllIn(tiers, shipping) * quantity,
  };
}

/** The 9 participations of the example week (index §5.7), in join order. */
export function exampleWeekCm(): FixtureParticipant[] {
  const background: [number, number][] = [
    [20, 293],
    [18, 429],
    [16, 429],
    [14, 156],
    [12, 293],
    [12, 293],
  ];
  const rows = background.map(([quantity, shipping], i) =>
    fixtureParticipant(CM_TIERS, `bg${i + 1}`, quantity, shipping, `2026-10-30T0${i + 1}:00:00Z`),
  );
  return [
    ...rows,
    fixtureParticipant(CM_TIERS, 'gerai', 4, 429, '2026-11-01T22:01:00Z', 16800),
    fixtureParticipant(CM_TIERS, 'kafe', 3, 429, '2026-11-01T22:03:00Z', 16700),
    fixtureParticipant(CM_TIERS, 'kedai', 6, 293, '2026-11-01T22:05:00Z', 16500),
  ];
}
