import type { ConsignmentStatus, Pickup, PickupStatus, Role } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { settlePickup } from '@/server/modules/checks/delivery-check';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { refreshRoundCompletion, roundsOfPickup } from '@/server/modules/rounds/completion';
import type { TxContext } from '@/server/platform/tx';

/** Consignment statuses at which a pickup's goods count as there (C4 gate 2). */
export const THERE: Record<'pickup_point' | 'door', ConsignmentStatus[]> = {
  pickup_point: ['arrived', 'completed'],
  door: ['out_for_delivery', 'delivered', 'completed'],
};

/**
 * Consignment statuses at which its goods can be collected on their own, before the rest of the
 * pickup is there (P1-8): at the pickup point, or delivered to the door.
 */
export const COLLECTABLE: Record<'pickup_point' | 'door', ConsignmentStatus[]> = {
  pickup_point: ['arrived', 'completed'],
  door: ['delivered', 'completed'],
};

/**
 * The allocations that still count: one cancelled for lateness (`cancelledLateAt` set) has been
 * refunded and is no longer part of any pickup. Every query for "the goods of a pickup" spreads
 * this into its `where`.
 */
export const LIVE_ALLOCATION = { cancelledLateAt: null } as const;

/** The live allocations not yet in a collection: what is still to be handed over. */
export const UNCOLLECTED = { ...LIVE_ALLOCATION, collectionId: null } as const;

/** Where owner and staff read a pickup. */
export const PICKUP_LINKS: [Role, (pickupId: string) => string][] = [
  ['owner', (id) => `/owner/pickups/${id}`],
  ['staff', (id) => `/staff/deliveries/${id}`],
];

/**
 * How many of the shop's lines for a pickup's place and date are still `active` or `kept`: rounds
 * not yet hub-checked, whose goods will join this pickup later (C4 gate 1).
 */
export function linesStillComing(
  tx: TxContext['tx'],
  pickup: Pick<Pickup, 'shopId' | 'deliveryDate' | 'destinationType' | 'pickupPointId'>,
): Promise<number> {
  return tx.participation.count({
    where: {
      shopId: pickup.shopId,
      deliveryDate: pickup.deliveryDate,
      status: { in: ['active', 'kept'] },
      ...(pickup.destinationType === 'door'
        ? { destinationType: 'door' }
        : { destinationType: 'pickup_point', pickupPointId: pickup.pickupPointId }),
    },
  });
}

/**
 * Settles a waiting pickup with nothing left to collect and no line still to come. With goods
 * handed over (collections) or live allocations, `settlePickup` moves it on (collected, then
 * closed once every collection is checked). With neither (all its goods were cancelled late), it
 * closes like the late cancellation's own close, and its rounds' completion is refreshed.
 */
async function settleEmptyPickup(ctx: TxContext, pickupId: string): Promise<void> {
  const { tx } = ctx;
  const [live, collections] = await Promise.all([
    tx.allocation.count({ where: { pickupId, allocated: { gt: 0 }, ...LIVE_ALLOCATION } }),
    tx.pickupCollection.count({ where: { pickupId } }),
  ]);
  if (live > 0 || collections > 0) {
    await settlePickup(ctx, pickupId);
    return;
  }
  const closed = await tx.pickup.updateMany({
    where: { id: pickupId, status: { in: ['waiting', 'partly_ready'] } },
    data: { status: 'closed' },
  });
  if (closed.count > 0) await refreshRoundCompletion(ctx, await roundsOfPickup(ctx, pickupId));
}

/**
 * Applies C4 to pickups still waiting for goods (`waiting`, or `partly_ready`). Of the goods not
 * collected yet: when (1) none of the shop's lines for that place and date is still `active` or
 * `kept` (a round not yet hub-checked) and (2) every consignment carrying them is there (`arrived`
 * for a pickup point, out for delivery or delivered for a door), a pickup-point pickup becomes
 * `ready` and a door pickup `out_for_delivery`. Otherwise, when some of them can be collected
 * (P1-8: arrived, or delivered to the door), it becomes `partly_ready`, even while gate 1 still
 * holds (P1-8 relaxes it). Owner and staff are told. A `partly_ready` pickup with nothing
 * collectable left goes back to `waiting`. A pickup with nothing left to collect and nothing
 * more to come is settled (`settleEmptyPickup`).
 */
export async function refreshPickupReadiness(ctx: TxContext, pickupIds: string[]): Promise<void> {
  const { tx, now } = ctx;
  for (const id of [...new Set(pickupIds)].sort()) {
    const pickup = await tx.pickup.findUnique({ where: { id } });
    if (!pickup || (pickup.status !== 'waiting' && pickup.status !== 'partly_ready')) continue;
    const isDoor = pickup.destinationType === 'door';

    // Gate 1 changes whenever a line leaves `active` or `kept`; each such path calls this through
    // `freePickupsOf` (round close and cancel, owner cancel) or directly (planning, shorted lines).
    const gateOpen = (await linesStillComing(tx, pickup)) === 0;

    const allocations = await tx.allocation.findMany({
      where: { pickupId: id, ...UNCOLLECTED },
      select: { consignmentId: true },
    });
    const consignmentIds = [...new Set(allocations.map((a) => a.consignmentId))];
    if (consignmentIds.includes(null)) continue;
    const statusOf = new Map(
      (
        await tx.consignment.findMany({
          where: { id: { in: consignmentIds as string[] } },
          select: { id: true, status: true },
        })
      ).map((c) => [c.id, c.status]),
    );
    const all = (statuses: ConsignmentStatus[]) =>
      consignmentIds.every((c) => statuses.includes(statusOf.get(c!)!));
    const some = (statuses: ConsignmentStatus[]) =>
      consignmentIds.some((c) => statuses.includes(statusOf.get(c!)!));

    let status: PickupStatus;
    if (consignmentIds.length > 0 && gateOpen && all(THERE[pickup.destinationType])) {
      status = isDoor ? 'out_for_delivery' : 'ready';
    } else if (some(COLLECTABLE[pickup.destinationType])) {
      status = 'partly_ready';
    } else if (consignmentIds.length === 0 && gateOpen) {
      // Nothing left to collect and nothing more to come: the last line still to be hub-checked
      // left without being planned (cancelled late or by the owner, its round cancelled or
      // failed), so the pickup is done.
      await settleEmptyPickup(ctx, pickup.id);
      continue;
    } else {
      // The part that could be collected is gone (cancelled late, possibly with nothing else
      // planned here yet, while a round is still to be hub-checked): wait for the rest again.
      // The cancellation that caused it is logged and announced; nothing is ready, so no notice.
      if (pickup.status === 'partly_ready') {
        await tx.pickup.updateMany({
          where: { id, status: 'partly_ready' },
          data: { status: 'waiting', readyAt: null },
        });
      }
      continue;
    }
    if (status === pickup.status) continue;

    const moved = await tx.pickup.updateMany({
      where: { id, status: pickup.status },
      data: { status, readyAt: now },
    });
    if (moved.count === 0) continue;

    await appendLog(ctx, {
      action: 'fulfilment.pickup_ready',
      subjectType: 'pickup',
      subjectId: id,
      scope: { shopId: pickup.shopId },
      before: { status: pickup.status },
      after: { status, deliveryDate: pickup.deliveryDate },
    });
    await emitEvent(ctx, 'pickup.ready', {
      pickupId: id,
      shopId: pickup.shopId,
      destinationType: pickup.destinationType,
      deliveryDate: pickup.deliveryDate,
      ...(status === 'partly_ready' ? { partly: true } : {}),
    });

    const point = isDoor
      ? null
      : await tx.pickupPoint.findUniqueOrThrow({
          where: { id: pickup.pickupPointId! },
          select: { name: true, openingHours: true },
        });
    const place = point
      ? { placeName: point.name, openingHours: point.openingHours, code: pickup.code }
      : null;
    let type: 'pickup.partly_ready' | 'pickup.out_for_delivery' | 'pickup.ready';
    let message;
    let dedupeKey;
    if (status === 'partly_ready') {
      type = 'pickup.partly_ready';
      message = TEMPLATES['pickup.partly_ready']({ ...place, code: pickup.code });
      // Each part that becomes ready is its own notice.
      const parts = await tx.pickupCollection.count({ where: { pickupId: id } });
      dedupeKey = `${type}:${id}:${parts}`;
    } else {
      type = isDoor ? 'pickup.out_for_delivery' : 'pickup.ready';
      message = place
        ? TEMPLATES['pickup.ready'](place)
        : TEMPLATES['pickup.out_for_delivery']({ code: pickup.code });
      dedupeKey = `${type}:${id}`;
    }
    // The same text for owner and staff, each linked to their own pickup page.
    for (const [role, link] of PICKUP_LINKS) {
      await notify(ctx, {
        type,
        audience: { shopId: pickup.shopId, roles: [role] },
        link: link(id),
        message,
        dedupeKey,
      });
    }
  }
}
