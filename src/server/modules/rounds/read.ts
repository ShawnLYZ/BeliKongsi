import type {
  Participation,
  Prisma,
  PrismaClient,
  Product,
  Round,
} from '@/generated/prisma/client';
import { tierForTotal } from '@/server/engine';
import type { TierView } from '@/lib/views/catalogue';
import type {
  MyParticipationView,
  OpenRoundView,
  RoundDetailView,
  RoundProgressView,
  RoundResultView,
  StaffOpenRoundView,
  StaffRoundDetailView,
} from '@/lib/views/rounds';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { AppError, forbidden, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { activeTotals, priceForShop, roundTiers } from './quote';

/** The one place a product picture's address is worked out. A product without a picture has none. */
export function productImageUrl(
  deps: Pick<AppDeps, 'storage'>,
  product: Pick<Product, 'imageKey'>,
): string | null {
  return product.imageKey ? deps.storage.publicUrl('product-images', product.imageKey) : null;
}

export const tierViews = (round: Pick<Round, 'tiersSnapshot'>): TierView[] =>
  roundTiers(round).map((t, i) => ({
    position: i + 1,
    minQuantity: t.minQuantity,
    unitPriceSen: t.unitPriceSen,
  }));

export const isStaff = (caller: Caller): boolean =>
  caller.kind === 'person' && caller.session.membership.role === 'staff';

/** Totals, tier and distance to the next tier. Counts only active participations. */
export async function roundProgress(
  db: Pick<PrismaClient, 'participation' | 'round'>,
  roundId: string,
): Promise<RoundProgressView> {
  const round = await db.round.findUniqueOrThrow({ where: { id: roundId } });
  const { totalQuantity, shopCount } = await activeTotals(db, roundId);
  const tiers = roundTiers(round);
  const currentTier = tierForTotal(tiers, totalQuantity);
  const next = tiers[currentTier ?? 0];
  return {
    totalQuantity,
    shopCount,
    currentTier,
    unitsToNextTier: next ? next.minQuantity - totalQuantity : null,
    nextTierUnitPriceSen: next ? next.unitPriceSen : null,
  };
}

function shopIdOf(caller: Caller): string | null {
  return caller.kind === 'person' ? (caller.session.membership.shopId ?? null) : null;
}

/** A supplier sees only its own supplier's rounds. */
function roundScope(caller: Caller): Prisma.RoundWhereInput {
  if (caller.kind === 'person' && caller.session.membership.role === 'supplier') {
    return { supplierId: caller.session.membership.supplierId ?? '' };
  }
  return {};
}

export async function listOpenRounds(
  deps: AppDeps,
  caller: Caller,
): Promise<OpenRoundView[] | StaffOpenRoundView[]> {
  const rounds = await deps.prisma.round.findMany({
    where: { status: 'open', ...roundScope(caller) },
    include: { product: true, hub: true },
    orderBy: [{ cutoffAt: 'asc' }, { product: { name: 'asc' } }],
  });
  if (isStaff(caller)) {
    return rounds.map((r) => ({
      roundId: r.id,
      productId: r.productId,
      name: r.product.name,
      shortName: r.product.shortName,
      packDescription: r.packDescription,
      unitName: r.unitName,
      imageUrl: productImageUrl(deps, r.product),
      imageAiGenerated: r.product.imageAiGenerated,
      cutoffAt: r.cutoffAt.toISOString(),
    }));
  }

  const shopId = shopIdOf(caller);
  const shop = shopId
    ? await deps.prisma.shop.findUnique({
        where: { id: shopId },
        include: { defaultPickupPoint: true },
      })
    : null;
  const views: OpenRoundView[] = [];
  for (const r of rounds) {
    const progress = await roundProgress(deps.prisma, r.id);
    let myPrice: OpenRoundView['myPrice'] = null;
    if (shop) {
      try {
        const q = await priceForShop(deps, r, shop, {
          quantity: 1,
          total: progress.totalQuantity,
          unitName: r.unitName,
        });
        myPrice = {
          destinationLabel: q.destinationLabel,
          unitShippingSen: q.unitShippingSen,
          startingAllInSen: q.starting.allInSen,
          projectedAllInSen: q.withoutYou.amounts?.allInSen ?? null,
        };
      } catch (error) {
        // A shop too far for door delivery simply has no price here.
        if (!(error instanceof AppError)) throw error;
      }
    }
    views.push({
      roundId: r.id,
      productId: r.productId,
      name: r.product.name,
      shortName: r.product.shortName,
      packDescription: r.packDescription,
      unitName: r.unitName,
      imageUrl: productImageUrl(deps, r.product),
      imageAiGenerated: r.product.imageAiGenerated,
      cutoffAt: r.cutoffAt.toISOString(),
      tiers: tierViews(r),
      buyAlonePriceSen: r.buyAlonePriceSen,
      progress,
      myPrice,
    });
  }
  return views;
}

function participationView(p: Participation): MyParticipationView {
  return {
    id: p.id,
    shopId: p.shopId,
    quantity: p.quantity,
    priceLimitSen: p.priceLimitSen,
    status: p.status,
    destinationType: p.destinationType,
    pickupPointId: p.pickupPointId,
    deliveryDate: p.deliveryDate,
    joinedAt: p.joinedAt.toISOString(),
    unitShippingSen: p.unitShippingSen,
    startingAllInSen: p.startingAllInSen,
    paidSen: p.paidSen,
  };
}

export async function getRoundForCaller(
  deps: AppDeps,
  caller: Caller,
  roundId: string,
): Promise<RoundDetailView | StaffRoundDetailView> {
  if (!UUID.test(roundId)) throw notFound('Round');
  const round = await deps.prisma.round.findFirst({
    where: { id: roundId, ...roundScope(caller) },
    include: { product: true },
  });
  if (!round) throw notFound('Round');

  let nextRoundCutoffAt: string | null = null;
  let nextRoundId: string | null = null;
  if (round.status !== 'open') {
    const next = await deps.prisma.round.findFirst({
      where: { productId: round.productId, status: 'open' },
      orderBy: { cutoffAt: 'asc' },
    });
    nextRoundCutoffAt = next ? next.cutoffAt.toISOString() : null;
    nextRoundId = next?.id ?? null;
  }
  const base = {
    roundId: round.id,
    productId: round.productId,
    name: round.product.name,
    shortName: round.product.shortName,
    packDescription: round.packDescription,
    unitName: round.unitName,
    imageUrl: productImageUrl(deps, round.product),
    imageAiGenerated: round.product.imageAiGenerated,
    status: round.status,
    cutoffAt: round.cutoffAt.toISOString(),
    nextRoundCutoffAt,
    nextRoundId,
  };
  if (isStaff(caller)) return base;

  const shopId = shopIdOf(caller);
  if (caller.kind === 'person' && caller.session.membership.role === 'owner' && !shopId) {
    throw forbidden();
  }
  const mine = shopId
    ? await deps.prisma.participation.findMany({
        where: { roundId, shopId },
        orderBy: { joinedAt: 'asc' },
      })
    : [];
  const myParticipations = mine.map(participationView);
  return {
    ...base,
    expectedReadyAt: round.expectedReadyAt.toISOString(),
    tiers: tierViews(round),
    buyAlonePriceSen: round.buyAlonePriceSen,
    progress: await roundProgress(deps.prisma, round.id),
    myParticipations,
    result: await roundResult(deps.prisma, round),
  };
}

/**
 * The statuses of a line that went ahead at the close (kept, and what kept lines become later,
 * including a late cancellation after the close).
 */
const KEPT_STATUSES = [
  'kept',
  'allocated',
  'shorted',
  'received',
  'closed',
  'cancelled_late',
] as const;

/** A formed round's close result; null while open, or when it closed empty or failed. */
async function roundResult(
  db: Pick<PrismaClient, 'participation'>,
  round: Round,
): Promise<RoundResultView | null> {
  if (
    round.finalTier === null ||
    round.finalUnitPriceSen === null ||
    round.totalKept === null ||
    round.closedAt === null
  ) {
    return null;
  }
  const shops = await db.participation.findMany({
    where: { roundId: round.id, status: { in: [...KEPT_STATUSES] } },
    distinct: ['shopId'],
    select: { shopId: true },
  });
  return {
    finalTier: round.finalTier,
    finalUnitPriceSen: round.finalUnitPriceSen,
    totalKept: round.totalKept,
    shopCount: shops.length,
    closedAt: round.closedAt.toISOString(),
  };
}
