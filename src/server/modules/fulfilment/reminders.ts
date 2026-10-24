import { resolveClock } from '@/server/adapters/clock';
import {
  CHECK_REMINDER_MS,
  CHECK_WINDOW_MS,
  recordNotChecked,
} from '@/server/modules/checks/delivery-check';
import { lockDestinations } from '@/server/modules/fulfilment/plan';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { lockShop } from '@/server/modules/payments/fee';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction } from '@/server/platform/tx';
import { PICKUP_LINKS } from './readiness';

const HOUR_MS = 60 * 60 * 1000;

/** Hours after the pickup became ready: owner and staff are reminded at 24 and 72, Ops told at 168. */
const REMINDERS = [
  { key: 'd1', afterMs: 24 * HOUR_MS },
  { key: 'd3', afterMs: 72 * HOUR_MS },
  { key: 'd7', afterMs: 168 * HOUR_MS },
] as const;

/**
 * Reminds about goods waiting at a pickup point (P1-9, stories 75, 135). Counts from the pickup's
 * current `readyAt`, for pickups `ready` or `partly_ready` at a pickup point: owner and staff are
 * told after 1 day and after 3 days, Ops after 7 days. A door pickup is not included: its goods
 * are out for delivery to the shop's own door, so they are not "waiting at" a place. Each notice
 * is sent once per readiness episode (dedupe key `uncollected:<pickupId>:<readyAt ms>:d1|d3|d7`):
 * a pickup collected in parts becomes ready again with a new `readyAt`, and the rest gets its own
 * reminders (P1-8). Running every few minutes is safe. Each pickup has its own transaction. Returns how many pickups got a notice.
 */
export async function remindUncollected(deps: AppDeps): Promise<{ reminded: number }> {
  const now = (await resolveClock(deps)).now();
  const oldest = new Date(now.getTime() - REMINDERS[0].afterMs);
  const candidates = await deps.prisma.pickup.findMany({
    where: {
      status: { in: ['ready', 'partly_ready'] },
      destinationType: 'pickup_point',
      readyAt: { lte: oldest },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let reminded = 0;
  for (const { id } of candidates) {
    try {
      reminded += await withTransaction(deps, systemCaller('uncollected goods'), async (ctx) => {
        const { tx } = ctx;
        const head = await tx.pickup.findUnique({
          where: { id },
          select: { shopId: true, destinationKey: true },
        });
        if (!head) return 0;
        await lockShop(ctx, head.shopId);
        await lockDestinations(ctx, [head.destinationKey]);
        const pickup = await tx.pickup.findUniqueOrThrow({ where: { id } });
        if (
          !pickup.readyAt ||
          !pickup.pickupPointId ||
          (pickup.status !== 'ready' && pickup.status !== 'partly_ready')
        ) {
          return 0;
        }
        const waited = ctx.now.getTime() - pickup.readyAt.getTime();
        const due = REMINDERS.filter((r) => waited >= r.afterMs);
        if (due.length === 0) return 0;
        const point = await tx.pickupPoint.findUniqueOrThrow({
          where: { id: pickup.pickupPointId },
          select: { name: true, openingHours: true },
        });
        const shop = await tx.shop.findUniqueOrThrow({
          where: { id: pickup.shopId },
          select: { name: true },
        });
        let sent = 0;
        for (const { key } of due) {
          const dedupeKey = `uncollected:${id}:${pickup.readyAt.getTime()}:${key}`;
          if (key === 'd7') {
            sent += await notify(ctx, {
              type: 'ops.goods_uncollected',
              audience: { operator: true, roles: ['ops'] },
              link: '/ops',
              message: TEMPLATES['ops.goods_uncollected']({
                shopName: shop.name,
                placeName: point.name,
              }),
              dedupeKey,
            });
            continue;
          }
          const message = TEMPLATES['pickup.uncollected']({
            placeName: point.name,
            openingHours: point.openingHours,
            code: pickup.code,
          });
          for (const [role, link] of PICKUP_LINKS) {
            sent += await notify(ctx, {
              type: 'pickup.uncollected',
              audience: { shopId: pickup.shopId, roles: [role] },
              link: link(id),
              message,
              dedupeKey,
            });
          }
        }
        return sent > 0 ? 1 : 0;
      });
    } catch (error) {
      console.error(
        `Uncollected reminder failed for pickup ${id}:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { reminded };
}

/**
 * Enforces the 72-hour delivery-check window (P1-10, story 83), one collection at a time. A
 * collection with no check gets a reminder to owner and staff once 24 hours have passed (dedupe
 * key `check-reminder:<collectionId>`). At 72 hours it is closed as "received, not checked" by a
 * system check (`recordNotChecked`): savings stay estimated and no claim can follow. Returns how
 * many collections got a reminder and how many were closed.
 */
export async function enforceCheckWindow(
  deps: AppDeps,
): Promise<{ reminded: number; closed: number }> {
  const now = (await resolveClock(deps)).now();
  const candidates = await deps.prisma.pickupCollection.findMany({
    where: {
      deliveryCheck: { is: null },
      collectedAt: { lte: new Date(now.getTime() - CHECK_REMINDER_MS) },
    },
    select: { id: true, pickupId: true },
    orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
  });
  let reminded = 0;
  let closed = 0;
  for (const { id, pickupId } of candidates) {
    try {
      const result = await withTransaction(
        deps,
        systemCaller('delivery check window'),
        async (ctx) => {
          const { tx } = ctx;
          const head = await tx.pickup.findUnique({
            where: { id: pickupId },
            select: { shopId: true, destinationKey: true },
          });
          if (!head) return 'none';
          await lockShop(ctx, head.shopId);
          await lockDestinations(ctx, [head.destinationKey]);
          const collection = await tx.pickupCollection.findUnique({
            where: { id },
            include: { deliveryCheck: { select: { id: true } } },
          });
          if (!collection || collection.deliveryCheck) return 'none';
          const age = ctx.now.getTime() - collection.collectedAt.getTime();
          if (age >= CHECK_WINDOW_MS) {
            const pickup = await tx.pickup.findUniqueOrThrow({ where: { id: pickupId } });
            await recordNotChecked(ctx, pickup, id);
            return 'closed';
          }
          if (age < CHECK_REMINDER_MS) return 'none';
          const message = TEMPLATES['delivery.check_reminder']({ date: collection.collectedAt });
          let sent = 0;
          for (const [role, link] of PICKUP_LINKS) {
            sent += await notify(ctx, {
              type: 'delivery.check_reminder',
              audience: { shopId: head.shopId, roles: [role] },
              link: link(pickupId),
              message,
              dedupeKey: `check-reminder:${id}`,
            });
          }
          return sent > 0 ? 'reminded' : 'none';
        },
      );
      if (result === 'closed') closed += 1;
      if (result === 'reminded') reminded += 1;
    } catch (error) {
      console.error(
        `Check-window enforcement failed for collection ${id}:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { reminded, closed };
}
