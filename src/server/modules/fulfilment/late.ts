import type { Pickup, PickupStatus } from '@/generated/prisma/client';
import { mytDate, mytInstant } from '@/lib/time';
import { resolveClock } from '@/server/adapters/clock';
import { appendLog } from '@/server/modules/activity/log';
import { AMOUNT, notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { lockShop } from '@/server/modules/payments/fee';
import { systemCaller, type Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireOps } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { destinationKeyOf, lockDestinations } from './plan';
import { linesStillComing } from './readiness';

/**
 * Pickup statuses at which the goods are no longer late: ready, on their way to the door or handed
 * over. `partly_ready` counts only with nothing still to come: use `pickupNotLate`.
 */
export const NOT_LATE: PickupStatus[] = [
  'ready',
  'partly_ready',
  'out_for_delivery',
  'collected',
  'delivered',
];

/**
 * Whether a group's pickup says its goods are not late (R2, controller ruling on P1-8): `ready`,
 * out for delivery or handed over; `partly_ready` only when no round for its place and date is
 * still to be hub-checked. While one is, the part that arrived does not make the rest on time.
 */
export async function pickupNotLate(
  tx: TxContext['tx'],
  pickup: Pick<Pickup, 'status' | 'shopId' | 'deliveryDate' | 'destinationType' | 'pickupPointId'>,
): Promise<boolean> {
  if (!NOT_LATE.includes(pickup.status)) return false;
  if (pickup.status !== 'partly_ready') return true;
  return (await linesStillComing(tx, pickup)) === 0;
}

type Group = { shopId: string; destinationKey: string; deliveryDate: string };
type TimedGroup = Group & { expectedReadyAt: Date };
type Db = Pick<TxContext['tx'], 'participation'>;

const keyOf = (g: Group) => `${g.shopId}|${g.destinationKey}|${g.deliveryDate}`;
export const uniqueOf = (g: Group) => ({
  shopId_destinationKey_deliveryDate: {
    shopId: g.shopId,
    destinationKey: g.destinationKey,
    deliveryDate: g.deliveryDate,
  },
});

/**
 * Where owner and staff read a late group: its pickup page; before it has one, the owner's page
 * for the group (where a late item can be cancelled), else the staff list.
 */
const LINKS: [role: 'owner' | 'staff', page: (pickupId: string | null, g: Group) => string][] = [
  ['owner', (id, g) => (id ? `/owner/pickups/${id}` : `/owner/pickups/later/${groupKeyOf(g)}`)],
  ['staff', (id) => (id ? `/staff/deliveries/${id}` : '/staff/deliveries')],
];

/**
 * The key of a shop's group on the owner's pages (`PickupView.groupKey`): its date and pickup
 * point id, or `door`, as `<date>.<id|door>`. URL-safe; the shop is the caller's own.
 */
export function groupKeyOf(g: Pick<Group, 'deliveryDate' | 'destinationKey'>): string {
  const place = g.destinationKey.startsWith('door:') ? 'door' : g.destinationKey.slice(3);
  return `${g.deliveryDate}.${place}`;
}

/**
 * The groups (shop, destination key, delivery date) of participations still waiting for goods
 * (`kept` or `allocated`), each with the round time it was expected ready. A group's expected
 * time is its latest round's (the calendar gives them all the same).
 */
async function waitingGroups(
  db: Db,
  where: { roundId?: string; shopIds?: string[]; before?: Date },
): Promise<TimedGroup[]> {
  const parts = await db.participation.findMany({
    where: {
      status: { in: ['kept', 'allocated'] },
      ...(where.roundId ? { roundId: where.roundId } : {}),
      ...(where.shopIds ? { shopId: { in: where.shopIds } } : {}),
      ...(where.before ? { round: { expectedReadyAt: { lt: where.before } } } : {}),
    },
    select: {
      shopId: true,
      destinationType: true,
      pickupPointId: true,
      deliveryDate: true,
      round: { select: { expectedReadyAt: true } },
    },
    orderBy: { id: 'asc' },
  });
  const groups = new Map<string, TimedGroup>();
  for (const p of parts) {
    const group = {
      shopId: p.shopId,
      destinationKey: destinationKeyOf(p),
      deliveryDate: p.deliveryDate,
    };
    const have = groups.get(keyOf(group));
    if (!have || have.expectedReadyAt < p.round.expectedReadyAt) {
      groups.set(keyOf(group), { ...group, expectedReadyAt: p.round.expectedReadyAt });
    }
  }
  return [...groups.values()];
}

/** Tells owner and staff of a group, each linked to their own page for its pickup (if any). */
async function tellShop(
  ctx: TxContext,
  group: Group,
  pickupId: string | null,
  notice: Pick<Parameters<typeof notify>[1], 'type' | 'message' | 'dedupeKey'>,
): Promise<void> {
  for (const [role, page] of LINKS) {
    await notify(ctx, {
      ...notice,
      audience: { shopId: group.shopId, roles: [role] },
      link: page(pickupId, group),
    });
  }
}

/** The group's pickup, if it is planned yet. The caller holds the shop and destination locks. */
function pickupOfGroup(ctx: TxContext, group: Group) {
  return ctx.tx.pickup.findUnique({
    where: uniqueOf(group),
    select: {
      id: true,
      status: true,
      shopId: true,
      deliveryDate: true,
      destinationType: true,
      pickupPointId: true,
    },
  });
}

/**
 * Finds goods that are late (P1-7, story 74): a group whose pickup is not ready, out for delivery
 * or handed over when its expected ready time has passed. Each group is recorded once as a
 * `LateDelivery` and owner and staff are told once; a run that finds nothing new changes nothing.
 * Each group has its own transaction, so one failing group does not hold up the rest.
 */
export async function detectLateDeliveries(deps: AppDeps): Promise<{ detected: number }> {
  const now = (await resolveClock(deps)).now();
  const waiting = await waitingGroups(deps.prisma, { before: now });
  // Every page load runs this: skip, without a transaction or a lock, the groups already recorded
  // and those whose pickup is no longer late. The transaction checks both again under the locks.
  const shopIds = [...new Set(waiting.map((g) => g.shopId))];
  const [recorded, notLate] = await Promise.all([
    deps.prisma.lateDelivery.findMany({
      where: { shopId: { in: shopIds } },
      select: { shopId: true, destinationKey: true, deliveryDate: true },
    }),
    deps.prisma.pickup.findMany({
      // A partly ready pickup may still be late (`pickupNotLate`): the transaction decides.
      where: {
        shopId: { in: shopIds },
        status: { in: NOT_LATE.filter((s) => s !== 'partly_ready') },
      },
      select: { shopId: true, destinationKey: true, deliveryDate: true },
    }),
  ]);
  const skip = new Set([...recorded, ...notLate].map(keyOf));
  const candidates = waiting.filter((g) => !skip.has(keyOf(g)));
  let detected = 0;
  for (const group of candidates) {
    try {
      detected += await withTransaction(deps, systemCaller('late deliveries'), async (ctx) => {
        const { tx } = ctx;
        await lockShop(ctx, group.shopId);
        await lockDestinations(ctx, [group.destinationKey]);
        const pickup = await pickupOfGroup(ctx, group);
        if (pickup && (await pickupNotLate(tx, pickup))) return 0;
        const created = await tx.lateDelivery.createMany({
          data: [
            {
              shopId: group.shopId,
              destinationKey: group.destinationKey,
              deliveryDate: group.deliveryDate,
              originalExpectedAt: group.expectedReadyAt,
              detectedAt: ctx.now,
            },
          ],
          skipDuplicates: true,
        });
        if (created.count === 0) return 0;
        const row = await tx.lateDelivery.findUniqueOrThrow({ where: uniqueOf(group) });
        await appendLog(ctx, {
          action: 'fulfilment.late_detected',
          subjectType: 'late_delivery',
          subjectId: row.id,
          scope: { shopId: group.shopId, operator: true },
          after: {
            destinationKey: group.destinationKey,
            deliveryDate: group.deliveryDate,
            originalExpectedAt: group.expectedReadyAt.toISOString(),
          },
        });
        await tellShop(ctx, group, pickup?.id ?? null, {
          type: 'delivery.late',
          message: TEMPLATES['delivery.late']({ date: group.deliveryDate }),
          dedupeKey: `delivery-late:${row.id}`,
        });
        return 1;
      });
    } catch (error) {
      console.error(
        `Late-delivery check failed for ${keyOf(group)}:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { detected };
}

/**
 * Ops, acting as the logistics partner, sets a new date for the goods of a consignment or a
 * supplier order, with a reason (story 74). Every affected group (shop, place, date) gets its
 * `LateDelivery` updated (recorded first when detection has not found it yet) and owner and staff
 * are told. The new ready time is 10:00 Malaysia time on that date. Groups already ready or
 * handed over are left alone. A missing reason is 422 `REASON_REQUIRED`; a date before today
 * (Malaysia time) is 422 `DATE_IN_PAST`.
 */
export async function setNewDate(
  deps: AppDeps,
  caller: Caller,
  target: { consignmentId: string } | { supplierOrderId: string },
  input: { newDate: string; reason: string },
): Promise<void> {
  requireOps(caller);
  const isConsignment = 'consignmentId' in target;
  const id = isConsignment ? target.consignmentId : target.supplierOrderId;
  if (!UUID.test(id)) throw notFound(isConsignment ? 'Consignment' : 'Supplier order');
  const reason = input.reason.trim();
  if (!reason) throw unprocessable('REASON_REQUIRED', 'Please give a reason for the new date.');
  // Staff read the reason, and staff never see amounts (R6).
  if (AMOUNT.test(reason)) {
    throw unprocessable('REASON_HAS_AMOUNT', 'Please leave prices out of the reason.');
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.newDate);
  const [year, month, day] = [Number(date?.[1]), Number(date?.[2]), Number(date?.[3])];
  const real = new Date(Date.UTC(year, month - 1, day));
  // A shape-valid date such as 2026-02-31 would roll over, so check it names a real day.
  if (
    !date ||
    real.getUTCFullYear() !== year ||
    real.getUTCMonth() !== month - 1 ||
    real.getUTCDate() !== day
  ) {
    throw unprocessable('INVALID_DATE', 'Please give the new date as a real date, YYYY-MM-DD.');
  }
  if (input.newDate < mytDate((await resolveClock(deps)).now())) {
    throw unprocessable('DATE_IN_PAST', 'Please give a new date of today or later.');
  }
  const newExpectedAt = mytInstant(year, month, day, 10, 0);

  await withTransaction(deps, caller, async (ctx) => {
    const { tx } = ctx;
    // The groups the target carries goods for, then each with its own expected time.
    let wanted: Set<string>;
    let shopIds: string[];
    if (isConsignment) {
      if (!(await tx.consignment.findUnique({ where: { id }, select: { id: true } }))) {
        throw notFound('Consignment');
      }
      const allocations = await tx.allocation.findMany({
        where: { consignmentId: id, pickupId: { not: null } },
        select: { pickupId: true },
      });
      const pickups = await tx.pickup.findMany({
        where: { id: { in: allocations.map((a) => a.pickupId!) } },
        select: { shopId: true, destinationKey: true, deliveryDate: true },
      });
      wanted = new Set(pickups.map(keyOf));
      shopIds = pickups.map((p) => p.shopId);
    } else {
      const order = await tx.supplierOrder.findUnique({
        where: { id },
        select: { roundId: true },
      });
      if (!order) throw notFound('Supplier order');
      const ofRound = await waitingGroups(tx, { roundId: order.roundId });
      wanted = new Set(ofRound.map(keyOf));
      shopIds = ofRound.map((g) => g.shopId);
    }
    const groups = (await waitingGroups(tx, { shopIds: [...new Set(shopIds)] })).filter((g) =>
      wanted.has(keyOf(g)),
    );

    // Shops before destinations, each in order, like every fulfilment change.
    for (const shopId of [...new Set(groups.map((g) => g.shopId))].sort()) {
      await lockShop(ctx, shopId);
    }
    await lockDestinations(
      ctx,
      groups.map((g) => g.destinationKey),
    );
    for (const group of groups) {
      const pickup = await pickupOfGroup(ctx, group);
      if (pickup && (await pickupNotLate(tx, pickup))) continue;
      const row = await tx.lateDelivery.upsert({
        where: uniqueOf(group),
        create: {
          shopId: group.shopId,
          destinationKey: group.destinationKey,
          deliveryDate: group.deliveryDate,
          originalExpectedAt: group.expectedReadyAt,
          newExpectedAt,
          reason,
          detectedAt: ctx.now,
        },
        update: { newExpectedAt, reason },
      });
      await appendLog(ctx, {
        action: 'fulfilment.new_date_set',
        subjectType: 'late_delivery',
        subjectId: row.id,
        scope: { shopId: group.shopId, operator: true },
        after: {
          destinationKey: group.destinationKey,
          deliveryDate: group.deliveryDate,
          newExpectedAt: newExpectedAt.toISOString(),
        },
        reason,
      });
      await tellShop(ctx, group, pickup?.id ?? null, {
        type: 'delivery.new_date',
        message: TEMPLATES['delivery.new_date']({ newDate: input.newDate, reason }),
      });
    }
  });
}
