import type { Prisma, RoundStatus } from '@/generated/prisma/client';
import type { OpsRoundCard, OpsRoundDetail, OpsRoundsBoard, OpsRoundStatus } from '@/lib/views/ops';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireOps } from '@/server/platform/permissions';

const ORDER: OpsRoundStatus[] = [
  'scheduled',
  'open',
  'empty',
  'failed',
  'formed',
  'ordered',
  'confirmed',
  'dispatched',
  'at_hub',
  'completed',
  'cancelled',
];
/** Rounds that formed and went on (not cancelled afterwards). */
const WENT_FURTHER: RoundStatus[] = [
  'formed',
  'ordered',
  'confirmed',
  'dispatched',
  'at_hub',
  'completed',
];

const include = {
  product: true,
  supplier: true,
  hub: true,
  supplierOrder: { select: { id: true, status: true } },
} satisfies Prisma.RoundInclude;
type RoundRow = Prisma.RoundGetPayload<{ include: typeof include }>;

const card = (r: RoundRow, shopCount: number): OpsRoundCard => ({
  roundId: r.id,
  productName: r.product.name,
  supplierId: r.supplierId,
  supplierName: r.supplier.name,
  hubName: `${r.hub.region} hub`,
  cycleLabel: r.cycleLabel,
  status: r.status,
  cutoffAt: r.cutoffAt.toISOString(),
  finalTier: r.finalTier,
  finalUnitPriceSen: r.finalUnitPriceSen,
  totalKept: r.totalKept,
  shopCount,
  supplierOrderId: r.supplierOrder?.id ?? null,
  supplierOrderStatus: r.supplierOrder?.status ?? null,
});

/** Distinct shops with a live stake in each round (active, or kept and beyond). */
async function shopCounts(deps: AppDeps): Promise<Map<string, number>> {
  const rows = await deps.prisma.$queryRaw<{ round_id: string; shops: bigint }[]>`
    SELECT round_id, COUNT(DISTINCT shop_id) AS shops FROM participations
    WHERE status::text IN ('active', 'kept', 'allocated', 'shorted', 'received', 'closed')
    GROUP BY round_id`;
  return new Map(rows.map((r) => [r.round_id, Number(r.shops)]));
}

export async function opsRoundsBoard(
  deps: AppDeps,
  caller: Caller,
  filter: { status?: RoundStatus },
): Promise<OpsRoundsBoard> {
  requireOps(caller);
  const rounds = await deps.prisma.round.findMany({
    include,
    orderBy: [{ cutoffAt: 'desc' }, { id: 'asc' }],
  });
  const counts = await shopCounts(deps);
  const cards = rounds.map((r) => card(r, counts.get(r.id) ?? 0));

  const statuses = filter.status ? [filter.status] : ORDER;
  const columns = statuses.map((status) => ({
    status,
    rounds: cards.filter((c) => c.status === status),
  }));

  const formed = rounds.filter((r) => WENT_FURTHER.includes(r.status));
  const notFormed = rounds.filter((r) => r.status === 'failed' || r.status === 'cancelled').length;
  const closedNonEmpty = formed.length + notFormed;
  const tiers = formed.filter((r) => r.finalTier !== null);
  return {
    columns,
    stats: {
      successRate: closedNonEmpty === 0 ? 0 : formed.length / closedNonEmpty,
      averageTier: tiers.length ? tiers.reduce((s, r) => s + r.finalTier!, 0) / tiers.length : null,
      averageShopsPerRound: formed.length
        ? formed.reduce((s, r) => s + (counts.get(r.id) ?? 0), 0) / formed.length
        : null,
    },
  };
}

export async function opsRoundDetail(
  deps: AppDeps,
  caller: Caller,
  roundId: string,
): Promise<OpsRoundDetail> {
  requireOps(caller);
  if (!UUID.test(roundId)) throw notFound('Round');
  const r = await deps.prisma.round.findUnique({ where: { id: roundId }, include });
  if (!r) throw notFound('Round');

  const parts = await deps.prisma.participation.findMany({
    where: { roundId },
    include: { shop: { select: { name: true } } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const [allocs, postings] = await Promise.all([
    deps.prisma.allocation.findMany({
      where: { participationId: { in: parts.map((p) => p.id) } },
    }),
    deps.prisma.ledgerPosting.findMany({
      where: { roundId },
      select: { kind: true, amountSen: true, participationId: true },
    }),
  ]);
  const allocOf = new Map(allocs.map((a) => [a.participationId, a]));
  const refundOf = new Map<string, number>();
  const postingsByKind: Record<string, number> = {};
  for (const p of postings) {
    postingsByKind[p.kind] = (postingsByKind[p.kind] ?? 0) + p.amountSen;
    if (p.kind.startsWith('refund_') && p.participationId) {
      refundOf.set(p.participationId, (refundOf.get(p.participationId) ?? 0) + p.amountSen);
    }
  }

  const report = await runMoneyChecks(deps.prisma);
  const partIds = new Set(parts.map((p) => p.id));
  const checks = report.checks.map((c) => {
    const failures = c.failures.filter(
      (f) =>
        f.roundId === roundId ||
        (f.participationId !== undefined && partIds.has(f.participationId)),
    );
    return { ...c, passed: failures.length === 0, failures };
  });
  const liveShops = new Set(
    parts
      .filter((p) =>
        ['active', 'kept', 'allocated', 'shorted', 'received', 'closed'].includes(p.status),
      )
      .map((p) => p.shopId),
  );

  return {
    round: card(r, liveShops.size),
    participants: parts.map((p) => {
      const a = allocOf.get(p.id);
      return {
        participationId: p.id,
        shopId: p.shopId,
        shopName: p.shop.name,
        quantity: p.quantity,
        joinedAt: p.joinedAt.toISOString(),
        priceLimitSen: p.priceLimitSen,
        status: p.status,
        finalAllInSen: p.finalAllInSen,
        paidSen: p.paidSen,
        refundSen: refundOf.get(p.id) ?? 0,
        allocated: a ? a.allocated : null,
        missing: a ? a.missing : null,
      };
    }),
    engineResult: {
      finalTier: r.finalTier,
      finalUnitPriceSen: r.finalUnitPriceSen,
      totalAtCutoff: r.totalAtCutoff,
      totalKept: r.totalKept,
      closeIterations: r.closeIterations,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    },
    ledger: {
      holdBalanceSen: await balanceOf(deps.prisma, { kind: 'round_hold', roundId }),
      postingsByKind,
    },
    moneyCheck: { passed: checks.every((c) => c.passed), checks },
  };
}
