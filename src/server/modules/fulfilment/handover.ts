import type { Pickup, PickupStatus, Prisma } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import type { TxContext } from '@/server/platform/tx';
import { historyEntry } from './plan';
import { COLLECTABLE, linesStillComing, PICKUP_LINKS, UNCOLLECTED } from './readiness';

/** Pickup statuses at which the goods have left the pickup point or reached the door. */
export const HANDED_OVER: PickupStatus[] = ['collected', 'delivered', 'checked', 'closed'];

/** The status a whole pickup is handed over from: ready (pickup point) or out for delivery. */
export function handoverFrom(pickup: Pick<Pickup, 'destinationType'>): PickupStatus {
  return pickup.destinationType === 'door' ? 'out_for_delivery' : 'ready';
}

/** Whether a pickup's code hands goods over now: all of them, or (P1-8) the part already there. */
export function canHandOver(pickup: Pick<Pickup, 'destinationType' | 'status'>): boolean {
  return pickup.status === handoverFrom(pickup) || pickup.status === 'partly_ready';
}

/**
 * Hands over what a pickup has for the shop now, as one collection (PRD §10, P1-8). From `ready`
 * or `out_for_delivery` that is every live allocation not collected yet; from `partly_ready` only
 * those whose consignment can be collected (`COLLECTABLE`). The pickup becomes `collected`
 * (pickup point) or `delivered` (door), with the time and (for a person) who took it, once
 * nothing is left to collect and no round for its place and date is still to be hub-checked;
 * otherwise it goes back to `waiting` for the rest. Logs it, emits
 * `pickup.collected`, tells owner and staff of a door delivery, and completes the pickup-point
 * consignments now fully handed over. The caller holds the shop and destination locks. Returns the
 * new collection's id, or null, changing nothing, when the pickup could not be handed over.
 */
export async function handOverPickup(
  ctx: TxContext,
  pickup: Pickup,
  opts: { reason?: string; method?: 'code' | 'courier' | 'system' } = {},
): Promise<string | null> {
  const { tx, now, actor } = ctx;
  if (!canHandOver(pickup)) return null;
  const isDoor = pickup.destinationType === 'door';
  const from = pickup.status;
  const uncollected = await tx.allocation.findMany({
    where: { pickupId: pickup.id, ...UNCOLLECTED },
    select: { id: true, consignmentId: true },
    orderBy: { id: 'asc' },
  });
  let taken = uncollected;
  if (from === 'partly_ready') {
    const collectable = await tx.consignment.findMany({
      where: {
        id: { in: uncollected.flatMap((a) => (a.consignmentId ? [a.consignmentId] : [])) },
        status: { in: COLLECTABLE[pickup.destinationType] },
      },
      select: { id: true },
    });
    const ids = new Set(collectable.map((c) => c.id));
    taken = uncollected.filter((a) => a.consignmentId && ids.has(a.consignmentId));
  }
  if (taken.length === 0) return null;
  // Goods of a round not hub-checked yet will still join this pickup (P1-8 lets the rest go first).
  const complete =
    taken.length === uncollected.length && (await linesStillComing(tx, pickup)) === 0;
  const status = complete ? (isDoor ? 'delivered' : 'collected') : 'waiting';
  const userId = actor.type === 'person' ? actor.userId : null;
  const moved = await tx.pickup.updateMany({
    where: { id: pickup.id, status: from },
    data: { status, ...(complete ? { collectedAt: now, collectedByUserId: userId } : {}) },
  });
  if (moved.count === 0) return null;
  const collection = await tx.pickupCollection.create({
    data: {
      pickupId: pickup.id,
      collectedAt: now,
      collectedByUserId: userId,
      method: opts.method ?? 'code',
    },
  });
  await tx.allocation.updateMany({
    where: { id: { in: taken.map((a) => a.id) }, collectionId: null },
    data: { collectionId: collection.id },
  });

  await appendLog(ctx, {
    action: isDoor ? 'fulfilment.delivered' : 'fulfilment.pickup_collected',
    subjectType: 'pickup',
    subjectId: pickup.id,
    scope: { shopId: pickup.shopId },
    before: { status: from },
    after: { status, deliveryDate: pickup.deliveryDate, collectionId: collection.id },
    ...(opts.reason ? { reason: opts.reason } : {}),
  });
  await emitEvent(ctx, 'pickup.collected', {
    pickupId: pickup.id,
    shopId: pickup.shopId,
    destinationType: pickup.destinationType,
    deliveryDate: pickup.deliveryDate,
    collectionId: collection.id,
    complete,
  });

  if (isDoor) {
    for (const [role, link] of PICKUP_LINKS) {
      await notify(ctx, {
        type: 'pickup.delivered',
        audience: { shopId: pickup.shopId, roles: [role] },
        link: link(pickup.id),
        message: TEMPLATES['pickup.delivered'](),
        // The last part keeps the pickup's own key; an earlier part is keyed by its collection.
        dedupeKey: `pickup.delivered:${complete ? pickup.id : collection.id}`,
      });
    }
  } else {
    await completeConsignmentsOf(ctx, pickup.id);
  }
  return collection.id;
}

/**
 * Of the arrived pickup-point consignments carrying a pickup's goods (cancelled ones included),
 * completes each with nothing left to hand over (`completeConsignments`). Called after a
 * hand-over, a late cancellation and a settle. They share the pickup's destination, whose lock
 * the caller holds.
 */
export async function completeConsignmentsOf(ctx: TxContext, pickupId: string): Promise<void> {
  const lines = await ctx.tx.allocation.findMany({
    where: { pickupId, consignmentId: { not: null } },
    select: { consignmentId: true },
  });
  await completeConsignments(ctx, [...new Set(lines.map((l) => l.consignmentId!))]);
}

/**
 * Moves each of the given consignments that is an arrived pickup-point consignment, and whose
 * live goods are all handed over (collected, or on a pickup handed over; goods cancelled late do
 * not count), to `completed`, with its history, log entry and event. The caller holds the lock of
 * their destination.
 */
export async function completeConsignments(
  ctx: TxContext,
  consignmentIds: string[],
): Promise<void> {
  const { tx } = ctx;
  const consignments = await tx.consignment.findMany({
    where: { id: { in: consignmentIds }, destinationType: 'pickup_point', status: 'arrived' },
    orderBy: { id: 'asc' },
  });
  for (const c of consignments) {
    const carried = await tx.allocation.findMany({
      where: { consignmentId: c.id, pickupId: { not: null }, ...UNCOLLECTED },
      select: { pickupId: true },
    });
    const open = await tx.pickup.count({
      where: {
        id: { in: [...new Set(carried.map((a) => a.pickupId!))] },
        status: { notIn: HANDED_OVER },
      },
    });
    if (open > 0) continue;

    const history = [...(c.statusHistory as Prisma.JsonArray), historyEntry(ctx, 'completed')];
    const moved = await tx.consignment.updateMany({
      where: { id: c.id, status: 'arrived' },
      data: { status: 'completed', statusHistory: history },
    });
    if (moved.count === 0) continue;
    await appendLog(ctx, {
      action: 'fulfilment.consignment_status_changed',
      subjectType: 'consignment',
      subjectId: c.id,
      scope: { operator: true },
      before: { status: 'arrived' },
      after: { status: 'completed' },
    });
    await emitEvent(ctx, 'consignment.status_changed', {
      consignmentId: c.id,
      hubId: c.hubId,
      destinationType: c.destinationType,
      destinationId: c.pickupPointId!,
      status: 'completed',
    });
  }
}
