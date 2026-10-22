import type { DestinationType, Prisma } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { refundDeliveryFeeIfUnused } from '@/server/modules/payments/delivery-fees';
import { actorOf, systemCaller } from '@/server/platform/caller';
import type { TxContext } from '@/server/platform/tx';
import { newPickupCode } from './codes';
import { refreshPickupReadiness } from './readiness';

/** `pp:<pickupPointId>` for a pickup point, `door:<shopId>` for door delivery. */
export function destinationKeyOf(p: {
  destinationType: DestinationType;
  pickupPointId: string | null;
  shopId: string;
}): string {
  return p.destinationType === 'door' ? `door:${p.shopId}` : `pp:${p.pickupPointId}`;
}

/**
 * Takes the fulfilment lock of each destination, once and in key order. Planning, consignment
 * status moves and round cancellations all take it (after any shop locks) before they touch a
 * destination's consignments or apply C4 to its pickups, so two of them never decide readiness
 * on each other's uncommitted state.
 */
export async function lockDestinations(ctx: TxContext, keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fulfilment:${key}`}))`;
  }
}

/**
 * Applies C4 to the pickups of lines that just left `active` or `kept` (refunded, dropped or
 * cancelled): they no longer hold back their shop's pickup for that place and date (gate 1). Takes
 * the destinations' locks first, so call it after any shop locks (shop, then destination).
 */
export async function freePickupsOf(
  ctx: TxContext,
  lines: {
    shopId: string;
    destinationType: DestinationType;
    pickupPointId: string | null;
    deliveryDate: string;
  }[],
): Promise<void> {
  if (lines.length === 0) return;
  await lockDestinations(ctx, lines.map(destinationKeyOf));
  const held = await ctx.tx.pickup.findMany({
    where: {
      OR: lines.map((p) => ({
        shopId: p.shopId,
        destinationKey: destinationKeyOf(p),
        deliveryDate: p.deliveryDate,
      })),
    },
    select: { id: true },
  });
  await refreshPickupReadiness(
    ctx,
    held.map((p) => p.id),
  );
}

/** One `statusHistory` entry: the status, when, and who (an id, never a name). */
export function historyEntry(ctx: TxContext, status: string): Prisma.InputJsonObject {
  const { actor } = ctx;
  return {
    status,
    at: ctx.now.toISOString(),
    actor:
      actor.type === 'person' ? { type: 'person', userId: actor.userId } : { type: actor.type },
  };
}

/**
 * Plans a hub-checked round's goods (PRD §10, C3): each allocated line joins the `planned`
 * consignment from the round's hub to its destination for its date, or starts the next wave, and
 * joins its shop's pickup for that place and date (one per shop, place and date, with a code).
 * Shorted lines get neither; their door delivery fee goes back if nothing else needs it. Runs in
 * the hub check's transaction, logged by the system. Then applies C4 to the touched pickups.
 */
export async function planConsignmentsAndPickups(
  outer: TxContext,
  roundId: string,
): Promise<{ consignmentIds: string[]; pickupIds: string[] }> {
  // Same transaction and time as the hub check, but planning is the system's doing.
  const caller = systemCaller('consignment planning');
  const ctx: TxContext = { ...outer, caller, actor: actorOf(caller) };
  const { tx } = ctx;
  const round = await tx.round.findUniqueOrThrow({
    where: { id: roundId },
    select: { hubId: true },
  });
  const parts = await tx.participation.findMany({
    where: { roundId, status: { in: ['allocated', 'shorted'] } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const allocations = await tx.allocation.findMany({
    where: { participationId: { in: parts.map((p) => p.id) } },
  });
  const allocationOf = new Map(allocations.map((a) => [a.participationId, a]));

  // Serialises waves and codes across hub checks, and readiness against status moves.
  await lockDestinations(ctx, parts.map(destinationKeyOf));

  const consignmentIds = new Set<string>();
  const pickupIds = new Set<string>();
  const shorted: typeof parts = [];
  for (const p of parts) {
    const allocation = allocationOf.get(p.id);
    if (!allocation || allocation.allocated === 0) {
      shorted.push(p);
      continue;
    }
    const destinationKey = destinationKeyOf(p);
    const consignmentId = await consignmentFor(ctx, round.hubId, p, destinationKey);
    const pickupId = await pickupFor(ctx, p, destinationKey);
    await tx.allocation.update({
      where: { id: allocation.id },
      data: { consignmentId, pickupId },
    });
    consignmentIds.add(consignmentId);
    pickupIds.add(pickupId);
  }

  // A shorted line no longer holds back its shop's pickup for that place and date (C4 gate 1).
  const freed = new Set<string>();
  const refunded = new Set<string>();
  for (const p of shorted) {
    const existing = await tx.pickup.findUnique({
      where: {
        shopId_destinationKey_deliveryDate: {
          shopId: p.shopId,
          destinationKey: destinationKeyOf(p),
          deliveryDate: p.deliveryDate,
        },
      },
      select: { id: true },
    });
    if (existing) freed.add(existing.id);
    const feeKey = `${p.shopId}:${p.deliveryDate}`;
    if (p.destinationType === 'door' && !refunded.has(feeKey)) {
      refunded.add(feeKey);
      // refundDeliveryFeeIfUnused takes lockShop after the destination locks above, against the
      // shop-then-destination order. Safe only because the hub check already holds every shop
      // lock of this round's lines (hub-check.ts) and advisory locks are re-entrant, so this
      // waits on nothing; a new caller of planning must take those shop locks first too.
      await refundDeliveryFeeIfUnused(ctx, p.shopId, p.deliveryDate);
    }
  }

  await refreshPickupReadiness(ctx, [...pickupIds, ...freed]);
  return { consignmentIds: [...consignmentIds], pickupIds: [...pickupIds] };
}

type Line = {
  shopId: string;
  destinationType: DestinationType;
  pickupPointId: string | null;
  deliveryDate: string;
};

/** The `planned` consignment for the hub, destination and date, or a new one in the next wave. */
async function consignmentFor(
  ctx: TxContext,
  hubId: string,
  line: Line,
  destinationKey: string,
): Promise<string> {
  const { tx } = ctx;
  const where = { hubId, destinationKey, deliveryDate: line.deliveryDate };
  const planned = await tx.consignment.findFirst({
    where: { ...where, status: 'planned' },
    orderBy: { wave: 'desc' },
    select: { id: true },
  });
  if (planned) return planned.id;

  const last = await tx.consignment.findFirst({
    where,
    orderBy: { wave: 'desc' },
    select: { wave: true },
  });
  const isDoor = line.destinationType === 'door';
  const created = await tx.consignment.create({
    data: {
      hubId,
      destinationType: line.destinationType,
      pickupPointId: isDoor ? null : line.pickupPointId,
      shopId: isDoor ? line.shopId : null,
      destinationKey,
      deliveryDate: line.deliveryDate,
      wave: (last?.wave ?? 0) + 1,
      status: 'planned',
      statusHistory: [historyEntry(ctx, 'planned')],
      partnerReference: ctx.deps.logistics.newConsignmentReference(),
    },
  });
  await appendLog(ctx, {
    action: 'fulfilment.consignment_created',
    subjectType: 'consignment',
    subjectId: created.id,
    scope: { operator: true, ...(isDoor ? { shopId: line.shopId } : {}) },
    after: {
      status: 'planned',
      hubId,
      destinationType: created.destinationType,
      destinationKey,
      deliveryDate: created.deliveryDate,
      wave: created.wave,
      partnerReference: created.partnerReference,
    },
  });
  return created.id;
}

/** The shop's pickup for the destination and date, or a new `waiting` one with a fresh code. */
async function pickupFor(ctx: TxContext, line: Line, destinationKey: string): Promise<string> {
  const { tx } = ctx;
  const existing = await tx.pickup.findUnique({
    where: {
      shopId_destinationKey_deliveryDate: {
        shopId: line.shopId,
        destinationKey,
        deliveryDate: line.deliveryDate,
      },
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.pickup.create({
    data: {
      shopId: line.shopId,
      destinationType: line.destinationType,
      pickupPointId: line.destinationType === 'door' ? null : line.pickupPointId,
      destinationKey,
      deliveryDate: line.deliveryDate,
      code: await newPickupCode(ctx, destinationKey),
      status: 'waiting',
    },
    select: { id: true },
  });
  return created.id;
}
