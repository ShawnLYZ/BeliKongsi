import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { quote, type Tier } from '@/server/engine';
import { simulatedLogistics, type LogisticsPartner } from '@/server/adapters/logistics';
import { unprocessable } from '@/server/platform/errors';
import { balanceOf } from '../ledger/accounts';
import { nearestPickupPoint } from '../directory/directory';
import { deliveryDateOf } from '../rounds/schedule';

type Db = Prisma.TransactionClient | PrismaClient;

export type BasketTotals = {
  itemsAtStartingSen: number;
  feeIncludedSen: number;
  deliveryFeeSen: number;
  totalNowSen: number;
  balanceAvailableSen: number;
  balanceAppliedSen: number;
  payNowSen: number;
  estimatedAfterCutoffSen: number;
  estimatedSavingsSen: number;
  savingsHasBuyAloneBasis: boolean;
};

/**
 * Whether a payment for `shopId` that includes a door line for `deliveryDate` carries the delivery
 * fee (PRD 6.9: one fee per shop per door delivery date). It does unless a `held` or
 * `passed_to_partner` charge already exists. Pending payments do not count: each one carries the
 * fee, and when a second one succeeds for a date already held, completion refunds its fee to the
 * shop balance, so the net charge stays one per date and a failed carrier can never lose it.
 */
export async function deliveryFeeDue(
  db: Db,
  shopId: string,
  deliveryDate: string,
): Promise<boolean> {
  const charged = await db.deliveryFeeCharge.findUnique({
    where: { shopId_deliveryDate: { shopId, deliveryDate } },
    select: { status: true },
  });
  return !(charged && (charged.status === 'held' || charged.status === 'passed_to_partner'));
}

const ZERO: Omit<BasketTotals, 'balanceAvailableSen'> = {
  itemsAtStartingSen: 0,
  feeIncludedSen: 0,
  deliveryFeeSen: 0,
  totalNowSen: 0,
  balanceAppliedSen: 0,
  payNowSen: 0,
  estimatedAfterCutoffSen: 0,
  estimatedSavingsSen: 0,
  savingsHasBuyAloneBasis: false,
};

/**
 * The basket's money at instant `at`: only lines whose round is still open at `at` count. Items are
 * at starting prices (tier 1, fee and shipping included); the estimate projects the tier the round
 * reaches with this basket. The delivery fee follows `deliveryFeeDue`. The balance is used first.
 */
export async function basketTotals(
  db: Db,
  basketId: string,
  at: Date,
  logistics: LogisticsPartner = simulatedLogistics,
): Promise<BasketTotals> {
  const basket = await db.weeklyBasket.findUniqueOrThrow({
    where: { id: basketId },
    include: { shop: { include: { usualList: { include: { items: true } } } }, lines: true },
  });
  const { shop } = basket;
  const balanceAvailableSen = await balanceOf(db, { kind: 'shop_balance', shopId: shop.id });

  const roundIds = basket.lines.flatMap((l) => (!l.removed && l.roundId ? [l.roundId] : []));
  const rounds = await db.round.findMany({
    where: { id: { in: roundIds }, status: 'open', cutoffAt: { gt: at } },
    include: { hub: true, product: true },
  });
  if (rounds.length === 0) return { ...ZERO, balanceAvailableSen };
  const roundById = new Map(rounds.map((r) => [r.id, r]));

  const totals = await db.participation.groupBy({
    by: ['roundId'],
    where: { roundId: { in: rounds.map((r) => r.id) }, status: 'active' },
    _sum: { quantity: true },
  });
  const inRound = new Map(totals.map((t) => [t.roundId, t._sum.quantity ?? 0]));

  const points = await db.pickupPoint.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
  const nearest = nearestPickupPoint(points, shop);
  const door = basket.fulfilment === 'door';
  const pickupPoint = door
    ? nearest
    : (points.find((p) => p.id === (basket.pickupPointId ?? shop.defaultPickupPointId)) ?? nearest);
  if (!pickupPoint) throw unprocessable('NO_PICKUP_POINT', 'There is no pickup point to ship to.');

  const usualPrice = new Map(
    (shop.usualList?.items ?? []).map((i) => [i.productId, i.usualPriceSen]),
  );

  let itemsAtStartingSen = 0;
  let feeIncludedSen = 0;
  let estimatedAfterItemsSen = 0;
  let baselineSen = 0;
  let savingsHasBuyAloneBasis = false;
  const doorDates = new Set<string>();
  for (const line of basket.lines) {
    const round = line.roundId ? roundById.get(line.roundId) : undefined;
    if (line.removed || !round) continue;
    const shipping = logistics.quoteShipping({
      hub: round.hub,
      pickupPoint,
      unitWeightGrams: round.unitWeightGrams,
    });
    const q = quote({
      tiers: round.tiersSnapshot as unknown as Tier[],
      feeBps: round.feeBps,
      unitShippingSen: shipping.unitShippingSen,
      quantity: line.quantity,
      currentRoundTotal: inRound.get(round.id) ?? 0,
      priceLimitSen: line.priceLimitSen,
      unitName: round.unitName,
    });
    itemsAtStartingSen += q.startingLineSen;
    feeIncludedSen += q.starting.feeSen * line.quantity;
    const projectedUnit = q.withYou.amounts?.allInSen ?? q.starting.allInSen;
    estimatedAfterItemsSen += projectedUnit * line.quantity;
    const usual = usualPrice.get(line.productId) ?? null;
    if (usual === null) savingsHasBuyAloneBasis = true;
    baselineSen += (usual ?? round.buyAlonePriceSen) * line.quantity;
    if (door) doorDates.add(deliveryDateOf(round.cutoffAt));
  }

  let deliveryFeeSen = 0;
  if (door) {
    const fee = logistics.quoteDeliveryFee({ pickupPoint, shop });
    if (fee.feeSen === null) {
      throw unprocessable(
        'DOOR_TOO_FAR',
        'Door delivery is not available this far from a pickup point.',
        { distanceKm: fee.distanceKm },
      );
    }
    for (const date of [...doorDates].sort()) {
      if (await deliveryFeeDue(db, shop.id, date)) {
        deliveryFeeSen += fee.feeSen;
      }
    }
  }

  const totalNowSen = itemsAtStartingSen + deliveryFeeSen;
  const balanceAppliedSen = Math.min(balanceAvailableSen, totalNowSen);
  return {
    itemsAtStartingSen,
    feeIncludedSen,
    deliveryFeeSen,
    totalNowSen,
    balanceAvailableSen,
    balanceAppliedSen,
    payNowSen: totalNowSen - balanceAppliedSen,
    estimatedAfterCutoffSen: estimatedAfterItemsSen + deliveryFeeSen,
    estimatedSavingsSen: baselineSen - estimatedAfterItemsSen,
    savingsHasBuyAloneBasis,
  };
}
