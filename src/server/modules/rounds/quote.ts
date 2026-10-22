import type { PickupPoint, PrismaClient, Round, Shop } from '@/generated/prisma/client';
import { quote, type QuoteResult, type Tier } from '@/server/engine';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { forbidden, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { nearestPickupPoint } from '../directory/directory';

export type DestinationInput = { type: 'pickup_point'; pickupPointId: string } | { type: 'door' };

export type ShopQuote = QuoteResult & {
  unitShippingSen: number;
  deliveryFeeSen: number | null;
  destinationLabel: string;
  destination: DestinationInput;
};

type RoundWithHub = Round & { hub: { lat: number; lng: number } };
type ShopWithDefault = Shop & { defaultPickupPoint: PickupPoint | null };

/** The units and shops in a round that count: active participations only. */
export async function activeTotals(
  db: Pick<PrismaClient, 'participation'>,
  roundId: string,
): Promise<{ totalQuantity: number; shopCount: number }> {
  const rows = await db.participation.groupBy({
    by: ['shopId'],
    where: { roundId, status: 'active' },
    _sum: { quantity: true },
  });
  return {
    totalQuantity: rows.reduce((sum, r) => sum + (r._sum.quantity ?? 0), 0),
    shopCount: rows.length,
  };
}

export const roundTiers = (round: Pick<Round, 'tiersSnapshot'>): Tier[] =>
  round.tiersSnapshot as unknown as Tier[];

const noPickupPoint = () =>
  unprocessable('NO_PICKUP_POINT', 'There is no pickup point to ship to.');

/** Where this shop's goods go by default: its door, or its pickup point (else the nearest one). */
export function defaultDestination(shop: ShopWithDefault, points: PickupPoint[]): DestinationInput {
  if (shop.defaultFulfilment === 'door') return { type: 'door' };
  const id = shop.defaultPickupPoint?.id ?? nearestPickupPoint(points, shop)?.id;
  if (!id) throw noPickupPoint();
  return { type: 'pickup_point', pickupPointId: id };
}

function priceAtDestination(
  deps: AppDeps,
  round: RoundWithHub,
  shop: Shop,
  points: PickupPoint[],
  destination: DestinationInput,
) {
  let pickupPoint: PickupPoint | undefined;
  let deliveryFeeSen: number | null = null;
  let destinationLabel: string;
  if (destination.type === 'pickup_point') {
    pickupPoint = points.find((p) => p.id === destination.pickupPointId);
    if (!pickupPoint) throw notFound('Pickup point');
    destinationLabel = pickupPoint.name;
  } else {
    // Door delivery ships to the pickup point nearest the shop, then travels the last leg.
    pickupPoint = nearestPickupPoint(points, shop);
    if (!pickupPoint) throw noPickupPoint();
    const fee = deps.logistics.quoteDeliveryFee({ pickupPoint, shop });
    if (fee.feeSen === null) {
      throw unprocessable(
        'DOOR_TOO_FAR',
        'Door delivery is not available this far from a pickup point.',
        { distanceKm: fee.distanceKm },
      );
    }
    deliveryFeeSen = fee.feeSen;
    destinationLabel = `Delivery to your door (via ${pickupPoint.name})`;
  }
  const shipping = deps.logistics.quoteShipping({
    hub: round.hub,
    pickupPoint,
    unitWeightGrams: round.unitWeightGrams,
  });
  return { unitShippingSen: shipping.unitShippingSen, deliveryFeeSen, destinationLabel };
}

/** A shop's all-in quote for a round at a destination. Throws DOOR_TOO_FAR beyond 20 km. */
export async function priceForShop(
  deps: AppDeps,
  round: RoundWithHub,
  shop: ShopWithDefault,
  opts: {
    destination?: DestinationInput;
    quantity: number;
    total: number;
    priceLimitSen?: number | null;
    unitName: string;
    /** The active pickup points, when the caller already read them (inside its transaction). */
    points?: PickupPoint[];
  },
): Promise<ShopQuote> {
  const points =
    opts.points ??
    (await deps.prisma.pickupPoint.findMany({
      where: { active: true },
      orderBy: { id: 'asc' },
    }));
  const destination = opts.destination ?? defaultDestination(shop, points);
  const priced = priceAtDestination(deps, round, shop, points, destination);
  const result = quote({
    tiers: roundTiers(round),
    feeBps: round.feeBps,
    unitShippingSen: priced.unitShippingSen,
    quantity: opts.quantity,
    currentRoundTotal: opts.total,
    priceLimitSen: opts.priceLimitSen ?? null,
    unitName: opts.unitName,
  });
  return { ...result, ...priced, destination };
}

export async function quoteForShop(
  deps: AppDeps,
  caller: Caller,
  roundId: string,
  i: { quantity: number; destination?: DestinationInput; priceLimitSen?: number | null },
): Promise<ShopQuote> {
  if (caller.kind !== 'person' || !caller.session.membership.shopId) throw forbidden();
  const shopId = caller.session.membership.shopId;
  requireShopAccess(caller, shopId, ['owner']);
  if (!UUID.test(roundId)) throw notFound('Round');

  const round = await deps.prisma.round.findUnique({
    where: { id: roundId },
    include: { hub: true, product: true },
  });
  if (!round) throw notFound('Round');
  if (round.status !== 'open') {
    throw unprocessable('ROUND_NOT_OPEN', 'This round is no longer open.');
  }
  const shop = await deps.prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { defaultPickupPoint: true },
  });
  const { totalQuantity } = await activeTotals(deps.prisma, round.id);
  return priceForShop(deps, round, shop, {
    ...(i.destination ? { destination: i.destination } : {}),
    quantity: i.quantity,
    total: totalQuantity,
    priceLimitSen: i.priceLimitSen ?? null,
    unitName: round.product.unitName,
  });
}
