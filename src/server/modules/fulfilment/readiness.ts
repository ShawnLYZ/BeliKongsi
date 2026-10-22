import type { ConsignmentStatus, Role } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import type { TxContext } from '@/server/platform/tx';

/** Consignment statuses at which a pickup's goods count as there (C4 gate 2). */
const THERE: Record<'pickup_point' | 'door', ConsignmentStatus[]> = {
  pickup_point: ['arrived', 'completed'],
  door: ['out_for_delivery', 'delivered', 'completed'],
};

/** Where owner and staff read a pickup. */
export const PICKUP_LINKS: [Role, (pickupId: string) => string][] = [
  ['owner', (id) => `/owner/pickups/${id}`],
  ['staff', (id) => `/staff/deliveries/${id}`],
];

/**
 * Applies C4 to waiting pickups. A pickup moves on only when (1) none of the shop's lines for
 * that place and date is still `active` or `kept` (a round not yet hub-checked), and (2) every
 * consignment carrying its allocations is there: `arrived` for a pickup point, out for delivery
 * (or delivered) for a door. A pickup-point pickup then becomes `ready`, a door pickup
 * `out_for_delivery`; owner and staff are told. Never moves a pickup any further than that.
 */
export async function refreshPickupReadiness(ctx: TxContext, pickupIds: string[]): Promise<void> {
  const { tx, now } = ctx;
  for (const id of [...new Set(pickupIds)].sort()) {
    const pickup = await tx.pickup.findUnique({ where: { id } });
    if (!pickup || pickup.status !== 'waiting') continue;
    const isDoor = pickup.destinationType === 'door';

    const pending = await tx.participation.count({
      where: {
        shopId: pickup.shopId,
        deliveryDate: pickup.deliveryDate,
        status: { in: ['active', 'kept'] },
        ...(isDoor
          ? { destinationType: 'door' }
          : { destinationType: 'pickup_point', pickupPointId: pickup.pickupPointId }),
      },
    });
    // Gate 1 changes whenever a line leaves `active` or `kept`; each such path calls this through
    // `freePickupsOf` (round close and cancel, owner cancel) or directly (planning, shorted lines).
    if (pending > 0) continue;

    const allocations = await tx.allocation.findMany({
      where: { pickupId: id },
      select: { consignmentId: true },
    });
    const consignmentIds = [...new Set(allocations.map((a) => a.consignmentId))];
    if (consignmentIds.length === 0 || consignmentIds.includes(null)) continue;
    const there = await tx.consignment.count({
      where: {
        id: { in: consignmentIds as string[] },
        status: { in: THERE[pickup.destinationType] },
      },
    });
    if (there !== consignmentIds.length) continue;

    const status = isDoor ? 'out_for_delivery' : 'ready';
    const moved = await tx.pickup.updateMany({
      where: { id, status: 'waiting' },
      data: { status, readyAt: now },
    });
    if (moved.count === 0) continue;

    await appendLog(ctx, {
      action: 'fulfilment.pickup_ready',
      subjectType: 'pickup',
      subjectId: id,
      scope: { shopId: pickup.shopId },
      before: { status: 'waiting' },
      after: { status, deliveryDate: pickup.deliveryDate },
    });
    await emitEvent(ctx, 'pickup.ready', {
      pickupId: id,
      shopId: pickup.shopId,
      destinationType: pickup.destinationType,
      deliveryDate: pickup.deliveryDate,
    });

    let message;
    if (isDoor) {
      message = TEMPLATES['pickup.out_for_delivery']({ code: pickup.code });
    } else {
      const point = await tx.pickupPoint.findUniqueOrThrow({
        where: { id: pickup.pickupPointId! },
        select: { name: true, openingHours: true },
      });
      message = TEMPLATES['pickup.ready']({
        placeName: point.name,
        openingHours: point.openingHours,
        code: pickup.code,
      });
    }
    const type = isDoor ? 'pickup.out_for_delivery' : 'pickup.ready';
    // The same text for owner and staff, each linked to their own pickup page.
    for (const [role, link] of PICKUP_LINKS) {
      await notify(ctx, {
        type,
        audience: { shopId: pickup.shopId, roles: [role] },
        link: link(id),
        message,
        dedupeKey: `${type}:${id}`,
      });
    }
  }
}
