import type { PriceTier, Product, SupplierOrderStatus } from '@/generated/prisma/client';
import type {
  SupplierOpenRoundView,
  SupplierOrderView,
  SupplierPayoutView,
  SupplierProductView,
} from '@/lib/views/supplier';
import { resolveClock } from '@/server/adapters/clock';
import { productImageUrl, roundProgress } from '@/server/modules/rounds/read';
import { nextCutoffAfter } from '@/server/modules/rounds/schedule';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { requireSupplierAccess } from '@/server/platform/permissions';

const HIDDEN_FROM_SUPPLIER: SupplierOrderStatus[] = ['awaiting_ops', 'rejected_by_ops'];

// Every read here is for one supplier, and none of it reaches a shop.

export async function listSupplierOrders(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
  status?: SupplierOrderStatus,
): Promise<SupplierOrderView[]> {
  requireSupplierAccess(caller, supplierId);
  const isSupplier = caller.kind === 'person' && caller.session.membership.role === 'supplier';
  const rows = await deps.prisma.supplierOrder.findMany({
    where: {
      supplierId,
      // A supplier hears about an order only once Ops have approved it.
      ...(isSupplier
        ? status
          ? { status: HIDDEN_FROM_SUPPLIER.includes(status) ? { in: [] } : status }
          : { status: { notIn: HIDDEN_FROM_SUPPLIER } }
        : status
          ? { status }
          : {}),
    },
    include: { hub: true, round: { include: { product: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return rows.map((o) => ({
    supplierOrderId: o.id,
    roundId: o.roundId,
    productName: o.round.product.name,
    packDescription: o.round.packDescription,
    unitName: o.round.unitName,
    quantity: o.quantity,
    unitPriceSen: o.unitPriceSen,
    totalSen: o.totalSen,
    hubName: `${o.hub.region} hub`,
    requiredDispatchDate: o.requiredDispatchDate,
    expectedDispatchDate: o.expectedDispatchDate,
    status: o.status,
    approvalId: o.supplierApprovalId,
  }));
}

/** Open rounds as totals and a shop count only. */
export async function listSupplierRounds(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
): Promise<SupplierOpenRoundView[]> {
  requireSupplierAccess(caller, supplierId);
  const rounds = await deps.prisma.round.findMany({
    where: { supplierId, status: 'open' },
    include: { product: true },
    orderBy: [{ cutoffAt: 'asc' }, { id: 'asc' }],
  });
  const views: SupplierOpenRoundView[] = [];
  for (const r of rounds) {
    const progress = await roundProgress(deps.prisma, r.id);
    views.push({
      roundId: r.id,
      productName: r.product.name,
      unitName: r.unitName,
      cutoffAt: r.cutoffAt.toISOString(),
      totalQuantity: progress.totalQuantity,
      shopCount: progress.shopCount,
      currentTier: progress.currentTier,
    });
  }
  return views;
}

export async function listSupplierProducts(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
): Promise<SupplierProductView[]> {
  requireSupplierAccess(caller, supplierId);
  const [products, clock] = await Promise.all([
    deps.prisma.product.findMany({
      where: { supplierId },
      include: { tiers: { orderBy: { position: 'asc' } }, rounds: OPEN_ROUND_CUTOFF },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    resolveClock(deps),
  ]);
  const now = clock.now();
  return products.map((p) => toSupplierProductView(p, productImageUrl(deps, p), now));
}

/** The Prisma `include` for the product's open round's cut-off, as `toSupplierProductView` needs. */
export const OPEN_ROUND_CUTOFF = {
  where: { status: 'open' },
  select: { cutoffAt: true },
  take: 1,
} as const;

type ProductWithTiers = Product & { tiers: PriceTier[]; rounds: { cutoffAt: Date }[] };

/**
 * The cut-off of the first round a change made now reaches. The open round keeps its tiers, so it
 * is the round after it; with none open, the round that opens next. Inactive products open none.
 */
function nextRoundCutoff(p: ProductWithTiers, now: Date): Date | null {
  if (!p.active) return null;
  return nextCutoffAfter(p, p.rounds[0]?.cutoffAt ?? now);
}

export function toSupplierProductView(
  p: ProductWithTiers,
  imageUrl: string | null,
  now: Date,
): SupplierProductView {
  return {
    productId: p.id,
    name: p.name,
    shortName: p.shortName,
    category: p.category,
    packDescription: p.packDescription,
    unitName: p.unitName,
    unitWeightGrams: p.unitWeightGrams,
    buyAlonePriceSen: p.buyAlonePriceSen,
    tiers: [...p.tiers]
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        position: t.position,
        minQuantity: t.minQuantity,
        unitPriceSen: t.unitPriceSen,
      })),
    aliases: p.aliases,
    packConversions: Object.fromEntries(
      Object.entries((p.packConversions ?? {}) as Record<string, unknown>).filter(
        (e): e is [string, number] => typeof e[1] === 'number',
      ),
    ),
    cadence: p.cadence,
    scheduleAnchorWeek: p.scheduleAnchorWeek,
    cutoffWeekday: p.cutoffWeekday,
    cutoffTime: p.cutoffTime,
    active: p.active,
    imageUrl,
    imageAiGenerated: p.imageAiGenerated,
    nextRoundCutoffAt: nextRoundCutoff(p, now)?.toISOString() ?? null,
  };
}

/** Simulated payouts released after a hub check. */
export async function listSupplierPayouts(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
): Promise<SupplierPayoutView[]> {
  requireSupplierAccess(caller, supplierId);
  const isSupplier = caller.kind === 'person' && caller.session.membership.role === 'supplier';
  const rows = await deps.prisma.hubCheck.findMany({
    // Nothing was paid at 0, so the supplier sees no payout. Ops still see the hub check.
    where: { supplierOrder: { supplierId }, ...(isSupplier ? { payoutSen: { gt: 0 } } : {}) },
    include: { supplierOrder: { include: { round: { include: { product: true } } } } },
    orderBy: [{ checkedAt: 'desc' }, { id: 'asc' }],
  });
  return rows.map((h) => ({
    supplierOrderId: h.supplierOrderId,
    productName: h.supplierOrder.round.product.name,
    goodUnits: h.receivedCounted,
    amountSen: h.payoutSen,
    reference: h.payoutReference,
    paidAt: h.checkedAt.toISOString(),
    simulated: true as const,
  }));
}
