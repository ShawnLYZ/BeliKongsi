import type { ParticipationStatus, PrismaClient } from '@/generated/prisma/client';
import type { OwnerBasketView } from '@/lib/views/baskets';
import type { PickupView } from '@/lib/views/pickups';
import type {
  DeliveryResultView,
  MonthlySavingsItemView,
  MonthlySavingsView,
  SavingsView,
} from '@/lib/views/savings';
import { mytInstant, mytParts } from '@/lib/time';
import { participationSavings, percentSaved, type SavingsResult } from '@/server/engine';
import { resolveClock } from '@/server/adapters/clock';
import { listPendingApprovals } from '@/server/modules/approvals/approvals';
import { getCurrentBasket } from '@/server/modules/baskets/basket';
import { listShopPickups } from '@/server/modules/fulfilment/pickups';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { REFUND_KINDS } from '@/server/modules/ledger/refund-kinds';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { requireShopAccess } from '@/server/platform/permissions';

/** A participation with its allocation and the delivery check line on it, if checked. */
export interface ParticipationWithAllocationAndCheck {
  quantity: number;
  status: ParticipationStatus;
  baselineSen: number;
  baselineKind: 'usual' | 'buy_alone';
  finalAllInSen: number | null;
  allocation: {
    allocated: number;
    checkLines: { missing: number; damaged: number; receivedGood: number }[];
  } | null;
}

/**
 * Attaches each participation's allocation and delivery check line (the allocation has no
 * relation to its participation, so they are read in one extra query).
 */
export async function withAllocationAndCheck<T extends { id: string }>(
  prisma: Pick<PrismaClient, 'allocation'>,
  rows: T[],
): Promise<(T & Pick<ParticipationWithAllocationAndCheck, 'allocation'>)[]> {
  const allocations = await prisma.allocation.findMany({
    where: { participationId: { in: rows.map((r) => r.id) } },
    include: { checkLines: true },
  });
  const byParticipation = new Map(allocations.map((a) => [a.participationId, a]));
  return rows.map((r) => ({ ...r, allocation: byParticipation.get(r.id) ?? null }));
}

/** Statuses of lines that were refunded before any goods came: nothing was saved on them. */
export const REFUNDED: ParticipationStatus[] = [
  'cancelled',
  'dropped_price_limit',
  'refunded_failed',
  'refunded_round_cancelled',
];

/** What the delivery check found for a line, or null while it has not been checked. */
export function deliveryResultView(
  p: ParticipationWithAllocationAndCheck,
): DeliveryResultView | null {
  const line = p.allocation?.checkLines[0];
  return line
    ? { received: line.receivedGood, missing: line.missing, damaged: line.damaged }
    : null;
}

/**
 * The line's saving: estimated on every allocated unit until the delivery check, then verified on
 * the units that arrived. Null before the cut-off (no final price yet) and for refunded lines.
 */
export function participationSavingsView(
  p: ParticipationWithAllocationAndCheck,
): SavingsView | null {
  const result = participationSavingsResult(p);
  if (!result) return null;
  const { unitSavingSen, savingSen, status, basis } = result;
  return { savingSen, unitSavingSen, status, basis };
}

/** The engine's result for the line, with the units it counted; null as `participationSavingsView`. */
function participationSavingsResult(p: ParticipationWithAllocationAndCheck): SavingsResult | null {
  if (p.finalAllInSen === null || REFUNDED.includes(p.status)) return null;
  const check = p.allocation?.checkLines[0];
  return participationSavings({
    baselineSen: p.baselineSen,
    baselineKind: p.baselineKind,
    finalAllInSen: p.finalAllInSen,
    allocated: p.allocation?.allocated ?? p.quantity,
    missing: check?.missing ?? 0,
    damaged: check?.damaged ?? 0,
    verified: check !== undefined,
  });
}

/** The instants a `YYYY-MM` month (Malaysia time) starts and ends at. */
function monthRange(month: string): { from: Date; to: Date } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return {
    from: mytInstant(year, mon, 1, 0, 0),
    to: mon === 12 ? mytInstant(year + 1, 1, 1, 0, 0) : mytInstant(year, mon + 1, 1, 0, 0),
  };
}

function monthOf(now: Date): string {
  const { year, month } = mytParts(now);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * A shop's month (PRD §6.10, stories 84-87). Verified savings are those of checks submitted in the
 * month less the delivery fees of the door pickups checked in it; estimated savings are the kept
 * lines of rounds closed in the month that are not checked yet. Owner only. Without `month` it
 * is the current month.
 *
 * A past month's figures can still change: a check submitted later moves its lines from the
 * estimate of the month the round closed in to the verified figure of the month it was checked
 * in. A round that closed in one month and is checked in the next is therefore in neither
 * month's figure until the check, then only in the later one.
 */
export async function monthlySavings(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  month?: string,
): Promise<MonthlySavingsView> {
  requireShopAccess(caller, shopId, ['owner']);
  const key = month ?? monthOf((await resolveClock(deps)).now());
  const { from, to } = monthRange(key);
  const inMonth = { gte: from, lt: to };
  const { prisma } = deps;
  const include = { round: { include: { product: true } } };

  const [checkedLines, closedRows, hubRows, refunds, checks] = await Promise.all([
    prisma.deliveryCheckLine.findMany({
      where: { deliveryCheck: { submittedAt: inMonth, pickup: { shopId } } },
      select: { allocation: { select: { participationId: true } } },
    }),
    prisma.participation.findMany({
      where: { shopId, status: { notIn: [...REFUNDED, 'active'] }, round: { closedAt: inMonth } },
      include,
      orderBy: { id: 'asc' },
    }),
    prisma.participation.findMany({
      where: { shopId, round: { supplierOrder: { hubCheck: { checkedAt: inMonth } } } },
      select: { id: true, finalFeeSen: true },
    }),
    prisma.ledgerPosting.aggregate({
      where: { shopId, kind: { in: [...REFUND_KINDS, 'refund_claim'] }, occurredAt: inMonth },
      _sum: { amountSen: true },
    }),
    prisma.deliveryCheck.findMany({
      where: { submittedAt: inMonth, pickup: { shopId, destinationType: 'door' } },
      select: { pickup: { select: { deliveryDate: true } } },
    }),
  ]);
  const checkedRows = await prisma.participation.findMany({
    where: { id: { in: checkedLines.map((l) => l.allocation.participationId) } },
    include,
    orderBy: { id: 'asc' },
  });
  const [checked, closed, hubAllocations] = await Promise.all([
    withAllocationAndCheck(prisma, checkedRows),
    withAllocationAndCheck(prisma, closedRows),
    prisma.allocation.findMany({
      where: { participationId: { in: hubRows.map((r) => r.id) }, allocated: { gt: 0 } },
      select: { participationId: true, allocated: true },
    }),
  ]);
  const feeOf = new Map(hubRows.map((r) => [r.id, r.finalFeeSen ?? 0]));

  const fees = await prisma.deliveryFeeCharge.aggregate({
    where: {
      shopId,
      deliveryDate: { in: checks.map((c) => c.pickup.deliveryDate) },
      status: { not: 'refunded' },
    },
    _sum: { amountSen: true },
  });
  const deliveryFeesSen = fees._sum.amountSen ?? 0;

  // Lines checked in the month are verified in it; closed lines still unchecked are its estimates.
  const unchecked = closed.filter((p) => !p.allocation?.checkLines.length);
  const items: (MonthlySavingsItemView & { baselineSen: number; units: number })[] = [];
  for (const p of [...checked, ...unchecked]) {
    const savings = participationSavingsResult(p);
    if (!savings) continue;
    items.push({
      participationId: p.id,
      productName: p.round.product.name,
      status: savings.status,
      basis: savings.basis,
      savingSen: savings.savingSen,
      baselineSen: p.baselineSen,
      units: savings.units,
    });
  }

  const total = (rows: { savingSen: number }[]) => rows.reduce((sum, i) => sum + i.savingSen, 0);
  const verified = items.filter((i) => i.status === 'verified');
  const usual = verified.filter((i) => i.basis === 'usual_price');
  const kept = closed.filter((p) => p.finalAllInSen !== null);

  return {
    month: key,
    roundsJoined: kept.length,
    unitsBought: kept.reduce((sum, p) => sum + (p.allocation?.allocated ?? p.quantity), 0),
    refundsSen: refunds._sum.amountSen ?? 0,
    feesPaidSen: hubAllocations.reduce(
      (sum, a) => sum + a.allocated * feeOf.get(a.participationId)!,
      0,
    ),
    deliveryFeesSen,
    verifiedSavingsSen: total(verified) - deliveryFeesSen,
    estimatedSavingsSen: total(items.filter((i) => i.status === 'estimated')),
    percentSaved: percentSaved(usual),
    items: items.map(({ participationId, productName, status, basis, savingSen }) => ({
      participationId,
      productName,
      status,
      basis,
      savingSen,
    })),
  };
}

export interface HomeSummary {
  basket: OwnerBasketView | null;
  nextPickup: PickupView | null;
  savingsThisMonth: { verifiedSen: number; estimatedSen: number };
  balanceSen: number;
  pendingApprovals: number;
}

/** The owner's home screen in one call: this week's basket, next pickup, the month and balance. */
export async function homeSummary(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
): Promise<HomeSummary> {
  requireShopAccess(caller, shopId, ['owner']);
  const [basket, pickups, month, balanceSen, approvals] = await Promise.all([
    getCurrentBasket(deps, caller, shopId) as Promise<OwnerBasketView | null>,
    listShopPickups(deps, caller, shopId, { status: 'upcoming' }),
    monthlySavings(deps, caller, shopId),
    balanceOf(deps.prisma, { kind: 'shop_balance', shopId }),
    listPendingApprovals(deps, caller),
  ]);
  return {
    basket,
    nextPickup: pickups.items[0] ?? null,
    savingsThisMonth: {
      verifiedSen: month.verifiedSavingsSen,
      estimatedSen: month.estimatedSavingsSen,
    },
    balanceSen,
    pendingApprovals: approvals.length,
  };
}
