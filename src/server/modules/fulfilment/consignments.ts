import type { Consignment, ConsignmentStatus, Prisma } from '@/generated/prisma/client';
import { type PartnerStatus, nextConsignmentStep } from '@/lib/consignment-steps';
import type { ConsignmentHistoryEntry, ConsignmentView } from '@/lib/views/fulfilment';
import { appendLog } from '@/server/modules/activity/log';
import { getDemoState } from '@/server/modules/demo/demo';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { lockShop } from '@/server/modules/payments/fee';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireOps } from '@/server/platform/permissions';
import { type TxContext, withTransaction } from '@/server/platform/tx';
import { runBackgroundAutomation } from './background';
import { historyEntry, lockDestinations } from './plan';
import { refreshPickupReadiness } from './readiness';

export type { PartnerStatus };

/**
 * Ops (or the system) moves a consignment one partner step on (PRD §10, story 125):
 * planned → dispatched, then arrived for a pickup point, or out for delivery → delivered for a
 * door. Anything else is 409 `INVALID_TRANSITION`. A door dispatch hands the shop's held
 * delivery fee for that date to the logistics partner (PRD §8), once. Then applies C4 to the
 * pickups the consignment carries goods for. A door `delivered` leaves the pickup alone: the
 * shop's code hands the goods over.
 */
export async function updateConsignmentStatus(
  deps: AppDeps,
  caller: Caller,
  consignmentId: string,
  status: PartnerStatus,
): Promise<ConsignmentView> {
  requireOps(caller);
  if (!UUID.test(consignmentId)) throw notFound('Consignment');
  await withTransaction(deps, caller, (ctx) => changeConsignmentStatus(ctx, consignmentId, status));
  const [view] = await viewsOf(deps, { id: consignmentId });
  return view!;
}

/**
 * The step itself, in the caller's transaction (see `updateConsignmentStatus`; also the seed).
 * It checks no access: callers must have checked that the caller is Ops.
 */
export async function changeConsignmentStatus(
  ctx: TxContext,
  consignmentId: string,
  status: PartnerStatus,
): Promise<void> {
  const { tx } = ctx;
  const head = await tx.consignment.findUnique({
    where: { id: consignmentId },
    select: { destinationKey: true, shopId: true },
  });
  if (!head) throw notFound('Consignment');
  // Same lock order as the hub check: the shop first, then the destination (planning's lock),
  // so no hub check joins this consignment while it leaves.
  if (head.shopId) await lockShop(ctx, head.shopId);
  await lockDestinations(ctx, [head.destinationKey]);
  const c = await tx.consignment.findUniqueOrThrow({ where: { id: consignmentId } });

  if (nextConsignmentStep(c.destinationType, c.status) !== status) {
    throw conflict(
      'INVALID_TRANSITION',
      `A ${c.destinationType === 'door' ? 'door' : 'pickup point'} consignment cannot go from ${c.status} to ${status}.`,
    );
  }
  const history = [...(c.statusHistory as Prisma.JsonArray), historyEntry(ctx, status)];
  await tx.consignment.update({
    where: { id: c.id },
    data: { status, statusHistory: history },
  });

  let deliveryFeeSen = 0;
  if (c.destinationType === 'door' && status === 'dispatched') {
    deliveryFeeSen = await handOverDeliveryFee(ctx, c);
  }

  const destinationId = c.destinationType === 'door' ? c.shopId! : c.pickupPointId!;
  await appendLog(ctx, {
    action: 'fulfilment.consignment_status_changed',
    subjectType: 'consignment',
    subjectId: c.id,
    scope: { operator: true, ...(c.shopId ? { shopId: c.shopId } : {}) },
    before: { status: c.status },
    after: { status, ...(deliveryFeeSen > 0 ? { deliveryFeeToPartnerSen: deliveryFeeSen } : {}) },
  });
  await emitEvent(ctx, 'consignment.status_changed', {
    consignmentId: c.id,
    hubId: c.hubId,
    destinationType: c.destinationType,
    destinationId,
    status,
  });

  const pickups = await tx.allocation.findMany({
    where: { consignmentId: c.id, pickupId: { not: null } },
    select: { pickupId: true },
  });
  const pickupIds = pickups.map((a) => a.pickupId!);
  await refreshPickupReadiness(ctx, pickupIds);
  // Background shops collect on their own once goods are at the pickup point or delivered.
  if (status === 'arrived' || status === 'delivered') {
    await runBackgroundAutomation(ctx, pickupIds);
  }
}

/**
 * Posts the shop's held delivery fee for the consignment's date to the logistics partner
 * (`delivery_fee_hold → logistics_payable`) and marks the charge passed on. Only a `held` charge
 * moves, so a second door consignment to the same shop and date moves nothing. Returns the sen.
 */
async function handOverDeliveryFee(ctx: TxContext, c: Consignment): Promise<number> {
  const { tx } = ctx;
  const shopId = c.shopId!; // its lock is already held (see updateConsignmentStatus)
  const charge = await tx.deliveryFeeCharge.findUnique({
    where: { shopId_deliveryDate: { shopId, deliveryDate: c.deliveryDate } },
  });
  if (!charge || charge.status !== 'held') return 0;
  await post(ctx, {
    from: { kind: 'delivery_fee_hold', shopId, deliveryDate: c.deliveryDate },
    to: { kind: 'logistics_payable' },
    amountSen: charge.amountSen,
    kind: 'delivery_fee_to_partner',
    refs: { paymentId: charge.paymentId, shopId },
    memo: `The delivery fee for ${c.deliveryDate} went to the logistics partner at dispatch.`,
  });
  await tx.deliveryFeeCharge.update({
    where: { id: charge.id },
    data: { status: 'passed_to_partner' },
  });
  return charge.amountSen;
}

/** The Ops consignments board (with map data), newest delivery date first. */
export async function listConsignments(
  deps: AppDeps,
  caller: Caller,
  filter: { status?: ConsignmentStatus },
): Promise<ConsignmentView[]> {
  requireOps(caller);
  return viewsOf(deps, filter.status ? { status: filter.status } : {});
}

async function viewsOf(
  deps: AppDeps,
  where: Prisma.ConsignmentWhereInput,
): Promise<ConsignmentView[]> {
  const db = deps.prisma;
  const consignments = await db.consignment.findMany({
    where,
    orderBy: [{ deliveryDate: 'desc' }, { createdAt: 'asc' }, { wave: 'asc' }, { id: 'asc' }],
  });
  if (consignments.length === 0) return [];
  const ids = consignments.map((c) => c.id);
  const [hubs, points, shops, units, featured] = await Promise.all([
    db.hub.findMany({ where: { id: { in: consignments.map((c) => c.hubId) } } }),
    db.pickupPoint.findMany({
      where: {
        id: { in: consignments.flatMap((c) => (c.pickupPointId ? [c.pickupPointId] : [])) },
      },
    }),
    db.shop.findMany({
      where: { id: { in: consignments.flatMap((c) => (c.shopId ? [c.shopId] : [])) } },
      select: { id: true, name: true, lat: true, lng: true },
    }),
    db.allocation.groupBy({
      by: ['consignmentId'],
      where: { consignmentId: { in: ids } },
      _sum: { allocated: true },
    }),
    featuredConsignmentIds(deps, ids),
  ]);
  const hubOf = new Map(hubs.map((h) => [h.id, h]));
  const placeOf = new Map<string, { name: string; lat: number; lng: number }>([
    ...points.map((p) => [p.id, p] as const),
    ...shops.map((s) => [s.id, s] as const),
  ]);
  const unitsOf = new Map(units.map((u) => [u.consignmentId, u._sum.allocated ?? 0]));

  return consignments.map((c) => {
    const hub = hubOf.get(c.hubId)!;
    const place = placeOf.get(c.destinationType === 'door' ? c.shopId! : c.pickupPointId!)!;
    return {
      consignmentId: c.id,
      hubName: hub.name,
      hubLatLng: { lat: hub.lat, lng: hub.lng },
      destinationType: c.destinationType,
      destinationName: place.name,
      destinationLatLng: { lat: place.lat, lng: place.lng },
      deliveryDate: c.deliveryDate,
      wave: c.wave,
      status: c.status,
      statusHistory: c.statusHistory as unknown as ConsignmentHistoryEntry[],
      itemCount: unitsOf.get(c.id) ?? 0,
      containsFeaturedRound: featured.has(c.id),
      partnerReference: c.partnerReference,
    };
  });
}

/**
 * Of the given consignments, those carrying goods of the featured product's rounds
 * (`DemoSettings.featuredProductId`; `Round` has no flag of its own). Read by product rather than
 * by `getDemoState().featuredRoundId`: after the cut-off that is the next week's open round,
 * which has no goods on the road yet, while the week just hub-checked is the one being followed.
 */
export async function featuredConsignmentIds(
  deps: AppDeps,
  consignmentIds: string[],
): Promise<Set<string>> {
  const { featuredProductId } = await getDemoState(deps);
  if (!featuredProductId || consignmentIds.length === 0) return new Set();
  const lines = await deps.prisma.allocation.findMany({
    where: { consignmentId: { in: consignmentIds } },
    select: { consignmentId: true, participationId: true },
  });
  const featured = await deps.prisma.participation.findMany({
    where: {
      id: { in: lines.map((l) => l.participationId) },
      round: { productId: featuredProductId },
    },
    select: { id: true },
  });
  const ids = new Set(featured.map((p) => p.id));
  return new Set(lines.filter((l) => ids.has(l.participationId)).map((l) => l.consignmentId!));
}
