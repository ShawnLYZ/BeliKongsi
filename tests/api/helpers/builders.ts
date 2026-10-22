import type { ParticipationStatus, PrismaClient } from '@/generated/prisma/client';
import { unitAmounts } from '@/server/engine';

export interface ParticipationSpec {
  roundId: string;
  shopId: string;
  quantity: number;
  unitShippingSen: number;
  priceLimitSen?: number | null;
  status?: ParticipationStatus;
  joinedAt?: Date;
}

/**
 * Inserts a payment, its one payment line and a participation straight into the tables, at the
 * round's first tier and the shop's default destination. For read-only tests: no money moves.
 */
export async function insertParticipation(prisma: PrismaClient, spec: ParticipationSpec) {
  const round = await prisma.round.findUniqueOrThrow({ where: { id: spec.roundId } });
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: spec.shopId } });
  const tiers = round.tiersSnapshot as { minQuantity: number; unitPriceSen: number }[];
  const amounts = unitAmounts(tiers[0]!.unitPriceSen, round.feeBps, spec.unitShippingSen);
  const lineSen = amounts.allInSen * spec.quantity;
  const door = shop.defaultFulfilment === 'door';
  const joinedAt = spec.joinedAt ?? new Date('2026-11-02T01:00:00Z');

  const payment = await prisma.payment.create({
    data: {
      shopId: shop.id,
      purpose: 'join',
      linesTotalSen: lineSen,
      deliveryFeeSen: 0,
      totalSen: lineSen,
      balanceAppliedSen: 0,
      externalSen: lineSen,
      method: 'duitnow_qr',
      status: 'succeeded',
      deadlineAt: new Date(joinedAt.getTime() + 15 * 60_000),
      completedAt: joinedAt,
    },
  });
  const line = await prisma.paymentLine.create({
    data: {
      paymentId: payment.id,
      productId: round.productId,
      roundId: round.id,
      quantity: spec.quantity,
      priceLimitSen: spec.priceLimitSen ?? null,
      fulfilment: shop.defaultFulfilment,
      destinationType: door ? 'door' : 'pickup_point',
      pickupPointId: door ? null : shop.defaultPickupPointId,
      deliveryDate: '2026-11-12',
      unitGoodsSen: amounts.goodsSen,
      unitFeeSen: amounts.feeSen,
      unitShippingSen: spec.unitShippingSen,
      unitAllInSen: amounts.allInSen,
      lineSen,
      baselineSen: round.buyAlonePriceSen * spec.quantity,
      baselineKind: 'buy_alone',
    },
  });
  return prisma.participation.create({
    data: {
      roundId: round.id,
      shopId: shop.id,
      paymentId: payment.id,
      paymentLineId: line.id,
      quantity: spec.quantity,
      priceLimitSen: spec.priceLimitSen ?? null,
      fulfilment: shop.defaultFulfilment,
      destinationType: door ? 'door' : 'pickup_point',
      pickupPointId: door ? null : shop.defaultPickupPointId,
      deliveryDate: '2026-11-12',
      joinedAt,
      source: 'catalogue',
      unitShippingSen: spec.unitShippingSen,
      baselineSen: round.buyAlonePriceSen * spec.quantity,
      baselineKind: 'buy_alone',
      startingAllInSen: amounts.allInSen,
      paidSen: lineSen,
      status: spec.status ?? 'active',
      updatedAt: joinedAt,
    },
  });
}

export interface BuiltShop {
  shopId: string;
  userId: string;
}

/**
 * Inserts a shop at a position, with a user who owns it. Sign in as that user by posting its id to
 * /api/session; `app.as` only takes seeded user keys.
 */
export async function insertShop(
  prisma: PrismaClient,
  spec: { lat: number; lng: number; name?: string },
): Promise<BuiltShop> {
  const shop = await prisma.shop.create({
    data: {
      name: spec.name ?? 'Builder Shop',
      type: 'cafe',
      address: 'Jalan Builder',
      state: 'Perak',
      postcode: '30000',
      lat: spec.lat,
      lng: spec.lng,
      defaultFulfilment: 'pickup',
      isBackground: false,
    },
  });
  const user = await prisma.user.create({ data: { displayName: 'Builder Owner' } });
  await prisma.membership.create({
    data: { userId: user.id, orgType: 'shop', shopId: shop.id, role: 'owner' },
  });
  return { shopId: shop.id, userId: user.id };
}
