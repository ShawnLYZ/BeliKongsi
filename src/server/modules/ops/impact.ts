import type { ImpactView } from '@/lib/views/ops';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { requireOps } from '@/server/platform/permissions';

/** Median of the values, unrounded; the mean of the two middle values when even. */
function medianRaw(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median rounded half-up to a whole number, null for no values. */
export function median(values: number[]): number | null {
  const m = medianRaw(values);
  return m === null ? null : Math.floor(m + 0.5);
}

/** Nearest-rank 90th percentile, null for no values. */
function p90(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.9) - 1]!;
}

const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * The §27 metrics, computed on demand from existing tables (P1-15). Ops only.
 */
export async function impactMetrics(deps: AppDeps, caller: Caller): Promise<ImpactView> {
  requireOps(caller);
  const db = deps.prisma;

  // Time to approve: opening the basket to the successful payment, whole minutes rounded up.
  const opened = await db.weeklyBasket.findMany({
    where: { status: 'paid', firstOpenedAt: { not: null }, approvedByUserId: { not: null } },
    select: { id: true, firstOpenedAt: true },
  });
  const payments = await db.payment.findMany({
    where: { basketId: { in: opened.map((b) => b.id) }, status: 'succeeded' },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: { basketId: true, completedAt: true },
  });
  const minutes: number[] = [];
  for (const basket of opened) {
    const paid = payments.find((p) => p.basketId === basket.id);
    if (!paid?.completedAt || !basket.firstOpenedAt) continue;
    minutes.push(
      Math.max(
        0,
        Math.ceil((paid.completedAt.getTime() - basket.firstOpenedAt.getTime()) / 60_000),
      ),
    );
  }

  // Basket approval rate: paid baskets of the drafted baskets of real (non-background) shops.
  const shopFilter = { shop: { isBackground: false }, draftedAt: { not: null } };
  const drafted = await db.weeklyBasket.count({ where: shopFilter });
  const approved = await db.weeklyBasket.count({ where: { ...shopFilter, status: 'paid' } });

  // AI lines accepted unchanged: confirmed usual-list runs (text and photo) only. The canned saved
  // example (status 'saved_example') is not an AI reading, so it is left out.
  const runs = await db.aiSuggestionRun.findMany({
    where: {
      kind: { in: ['usual_list_text', 'usual_list_photo'] },
      status: 'succeeded',
      confirmedAt: { not: null },
    },
    select: { changeSummary: true },
  });
  let accepted = 0;
  let suggested = 0;
  for (const run of runs) {
    const s = (run.changeSummary ?? {}) as Record<string, unknown>;
    const unchanged = num(s.acceptedUnchanged);
    accepted += unchanged;
    suggested += unchanged + num(s.changed) + num(s.removed);
  }

  // Claim rate: claimed (missing + damaged) units of the units expected at delivery checks, for
  // real shops only. Simulated (background) shops get an automatic "All received" and never claim,
  // so counting them would dilute the rate.
  const background = (
    await db.shop.findMany({ where: { isBackground: true }, select: { id: true } })
  ).map((s) => s.id);
  const claimLines = await db.claimLine.aggregate({
    where: { claim: { shopId: { notIn: background } } },
    _sum: { missing: true, damaged: true },
  });
  const checkLines = await db.deliveryCheckLine.aggregate({
    where: { deliveryCheck: { pickup: { shopId: { notIn: background } } } },
    _sum: { expected: true },
  });
  const claimedUnits = (claimLines._sum.missing ?? 0) + (claimLines._sum.damaged ?? 0);
  const deliveredUnits = checkLines._sum.expected ?? 0;

  // Supplier reliability: hours to confirm, and good units of ordered units once hub-checked.
  // This is about the supplier, so every order it confirmed and delivered counts, including orders
  // that simulated shops' demand helped fill.
  const orders = await db.supplierOrder.findMany({
    select: {
      supplierId: true,
      quantity: true,
      createdAt: true,
      confirmedAt: true,
      supplier: { select: { name: true } },
      hubCheck: { select: { goodUnits: true } },
    },
  });
  const bySupplier = new Map<
    string,
    { name: string; waits: number[]; good: number; ordered: number }
  >();
  for (const o of orders) {
    const s = bySupplier.get(o.supplierId) ?? {
      name: o.supplier.name,
      waits: [],
      good: 0,
      ordered: 0,
    };
    if (o.confirmedAt)
      s.waits.push(Math.max(0, (o.confirmedAt.getTime() - o.createdAt.getTime()) / 60_000));
    if (o.hubCheck) {
      s.good += o.hubCheck.goodUnits;
      s.ordered += o.quantity;
    }
    bySupplier.set(o.supplierId, s);
  }
  const supplierReliability = [...bySupplier.entries()]
    .map(([supplierId, s]) => {
      const mins = medianRaw(s.waits);
      return {
        supplierId,
        supplierName: s.name,
        medianConfirmationHours: mins === null ? null : Math.round((mins / 60) * 100) / 100,
        goodUnitsRate: ratio(s.good, s.ordered),
      };
    })
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName));

  return {
    timeToApprove: {
      medianMinutes: median(minutes),
      p90Minutes: p90(minutes),
      samples: minutes.length,
    },
    basketApprovalRate: { approved, drafted, rate: ratio(approved, drafted) },
    aiLinesAcceptedUnchanged: { accepted, suggested, rate: ratio(accepted, suggested) },
    claimRate: { claimedUnits, deliveredUnits, rate: ratio(claimedUnits, deliveredUnits) },
    supplierReliability,
  };
}
