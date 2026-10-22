import type { Pickup, PickupStatus, Prisma } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import type { TxContext } from '@/server/platform/tx';
import { historyEntry } from './plan';
import { PICKUP_LINKS } from './readiness';

/** Pickup statuses at which the goods have left the pickup point or reached the door. */
export const HANDED_OVER: PickupStatus[] = ['collected', 'delivered', 'checked', 'closed'];

/** The one status a pickup can be handed over from: ready (pickup point) or out for delivery. */
export function handoverFrom(pickup: Pick<Pickup, 'destinationType'>): PickupStatus {
  return pickup.destinationType === 'door' ? 'out_for_delivery' : 'ready';
}

/**
 * Hands a pickup over (PRD §10): a ready pickup-point pickup becomes `collected`, a door pickup
 * out for delivery becomes `delivered`, with the time and (for a person) who took it. Logs it,
 * emits `pickup.collected`, tells owner and staff of a door delivery, and completes the
 * pickup-point consignments whose every pickup is now handed over. The caller holds the shop and
 * destination locks. Returns false, changing nothing, when the pickup was not in its `from` state.
 */
export async function handOverPickup(
  ctx: TxContext,
  pickup: Pickup,
  opts: { reason?: string } = {},
): Promise<boolean> {
  const { tx, now, actor } = ctx;
  const isDoor = pickup.destinationType === 'door';
  const from = handoverFrom(pickup);
  const status = isDoor ? 'delivered' : 'collected';
  const moved = await tx.pickup.updateMany({
    where: { id: pickup.id, status: from },
    data: {
      status,
      collectedAt: now,
      collectedByUserId: actor.type === 'person' ? actor.userId : null,
    },
  });
  if (moved.count === 0) return false;

  await appendLog(ctx, {
    action: isDoor ? 'fulfilment.delivered' : 'fulfilment.pickup_collected',
    subjectType: 'pickup',
    subjectId: pickup.id,
    scope: { shopId: pickup.shopId },
    before: { status: from },
    after: { status, deliveryDate: pickup.deliveryDate },
    ...(opts.reason ? { reason: opts.reason } : {}),
  });
  await emitEvent(ctx, 'pickup.collected', {
    pickupId: pickup.id,
    shopId: pickup.shopId,
    destinationType: pickup.destinationType,
    deliveryDate: pickup.deliveryDate,
  });

  if (isDoor) {
    for (const [role, link] of PICKUP_LINKS) {
      await notify(ctx, {
        type: 'pickup.delivered',
        audience: { shopId: pickup.shopId, roles: [role] },
        link: link(pickup.id),
        message: TEMPLATES['pickup.delivered'](),
        dedupeKey: `pickup.delivered:${pickup.id}`,
      });
    }
  } else {
    await completeConsignmentsOf(ctx, pickup.id);
  }
  return true;
}

/**
 * Of the arrived pickup-point consignments carrying a pickup's goods, moves each whose pickups
 * are all handed over to `completed`, with its history, log entry and event. They share the
 * pickup's destination, whose lock the caller holds.
 */
async function completeConsignmentsOf(ctx: TxContext, pickupId: string): Promise<void> {
  const { tx } = ctx;
  const lines = await tx.allocation.findMany({
    where: { pickupId, consignmentId: { not: null } },
    select: { consignmentId: true },
  });
  const consignments = await tx.consignment.findMany({
    where: {
      id: { in: [...new Set(lines.map((l) => l.consignmentId!))] },
      destinationType: 'pickup_point',
      status: 'arrived',
    },
    orderBy: { id: 'asc' },
  });
  for (const c of consignments) {
    const carried = await tx.allocation.findMany({
      where: { consignmentId: c.id, pickupId: { not: null } },
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
