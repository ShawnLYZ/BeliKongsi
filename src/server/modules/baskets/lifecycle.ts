import type { WeeklyBasket } from '@/generated/prisma/client';
import { resolveClock } from '@/server/adapters/clock';
import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { voidPayment } from '@/server/modules/payments/complete';
import { systemCaller, type Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';

const HOUR_MS = 3_600_000;

/**
 * Skips a draft basket for this week: nothing is charged. The caller decides the basket's approval
 * request (the inbox's reject does that itself).
 */
export async function skipDraftBasket(
  ctx: TxContext,
  basketId: string,
  reason: string | null,
): Promise<void> {
  const basket = await ctx.tx.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } });
  if (basket.status !== 'draft') {
    throw unprocessable('BASKET_NOT_EDITABLE', 'This basket can no longer be changed.');
  }
  await ctx.tx.weeklyBasket.update({
    where: { id: basketId },
    data: { status: 'skipped', skipReason: reason },
  });
  await appendLog(ctx, {
    action: 'basket.skipped',
    subjectType: 'weekly_basket',
    subjectId: basketId,
    scope: { shopId: basket.shopId },
    before: { status: 'draft' },
    after: { status: 'skipped' },
    ...(reason ? { reason } : {}),
  });
  await emitEvent(ctx, 'basket.skipped', {
    basketId,
    shopId: basket.shopId,
    week: basket.basketWeek,
  });
}

/** An owner skips this week's draft basket: nothing is charged and its approval is rejected. */
export async function skipBasket(
  deps: AppDeps,
  caller: Caller,
  basketId: string,
  input: { reason?: string },
): Promise<{ basketId: string; status: 'skipped' }> {
  if (!UUID.test(basketId)) throw notFound('Basket');
  return withTransaction(deps, caller, async (ctx) => {
    const locked = await ctx.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM weekly_baskets WHERE id = ${basketId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Basket');
    const basket = await ctx.tx.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } });
    requireShopAccess(caller, basket.shopId, ['owner']);
    const reason = input.reason?.trim() || null;
    await skipDraftBasket(ctx, basketId, reason);
    if (basket.approvalRequestId) {
      await ctx.tx.approvalRequest.updateMany({
        where: { id: basket.approvalRequestId, status: 'pending' },
        data: {
          status: 'rejected',
          decidedByUserId: caller.kind === 'person' ? caller.session.userId : null,
          decidedAt: ctx.now,
          reason,
        },
      });
    }
    return { basketId, status: 'skipped' as const };
  });
}

/**
 * Reminds owners who have not decided: once from 24 h before the deadline and once from 3 h
 * before. A run that first happens inside the last 3 h sends only the 3 h reminder, and nothing
 * is sent after the deadline. Each basket has its own transaction; one that fails is logged and
 * counted in `failed`, and the rest still get their reminder.
 */
export async function sendBasketReminders(
  deps: AppDeps,
): Promise<{ sent: number; failed: number }> {
  const now = (await resolveClock(deps)).now();
  const candidates = await deps.prisma.weeklyBasket.findMany({
    where: {
      status: 'draft',
      draftedAt: { not: null },
      deadlineAt: { gt: now, lte: new Date(now.getTime() + 24 * HOUR_MS) },
      approvalRequestId: { not: null },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let sent = 0;
  let failed = 0;
  for (const { id } of candidates) {
    try {
      sent += await withTransaction(deps, systemCaller('basket reminders'), async (ctx) => {
        const basket = await ctx.tx.weeklyBasket.findUniqueOrThrow({ where: { id } });
        if (
          basket.status !== 'draft' ||
          !basket.approvalRequestId ||
          basket.deadlineAt.getTime() <= ctx.now.getTime()
        ) {
          return 0;
        }
        const approval = await ctx.tx.approvalRequest.findUnique({
          where: { id: basket.approvalRequestId },
        });
        if (approval?.status !== 'pending') return 0;
        const left = basket.deadlineAt.getTime() - ctx.now.getTime();
        if (left > 24 * HOUR_MS) return 0;
        const when = left <= 3 * HOUR_MS ? '3h' : '24h';
        return notify(ctx, {
          type: 'basket.reminder',
          audience: { shopId: basket.shopId, roles: ['owner'] },
          link: '/owner/basket',
          message: TEMPLATES['basket.reminder']({ when }),
          dedupeKey: `basket-reminder:${basket.id}:${when}`,
        });
      });
    } catch (error) {
      failed += 1;
      console.error(
        `Basket reminder failed for ${id}:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { sent, failed };
}

/**
 * Voids the basket's pending payments and marks it expired, inside the caller's transaction.
 * `basket` is the row as the caller read it; after the voids the basket and its payments are read
 * again, because a payment result may have landed meanwhile. Returns false (and writes nothing
 * more) when the basket is no longer open or any of its payments succeeded.
 */
export async function expireBasketIn(ctx: TxContext, basket: WeeklyBasket): Promise<boolean> {
  const { tx } = ctx;
  const id = basket.id;
  const pending = await tx.payment.findMany({
    where: { basketId: id, status: 'pending' },
    orderBy: { id: 'asc' },
  });
  for (const payment of pending) await voidPayment(ctx, payment.id);

  const current = await tx.weeklyBasket.findUniqueOrThrow({ where: { id } });
  const succeeded = await tx.payment.count({ where: { basketId: id, status: 'succeeded' } });
  if ((current.status !== 'draft' && current.status !== 'payment_pending') || succeeded > 0) {
    return false;
  }

  await tx.weeklyBasket.update({ where: { id }, data: { status: 'expired' } });
  if (basket.approvalRequestId) {
    await tx.approvalRequest.updateMany({
      where: { id: basket.approvalRequestId, status: 'pending' },
      data: { status: 'expired', decidedAt: ctx.now },
    });
  }
  await appendLog(ctx, {
    action: 'basket.expired',
    subjectType: 'weekly_basket',
    subjectId: id,
    scope: { shopId: basket.shopId },
    before: { status: current.status },
    after: { status: 'expired' },
    reason: 'The basket passed its deadline without being paid.',
  });
  await emitEvent(ctx, 'basket.expired', {
    basketId: id,
    shopId: basket.shopId,
    week: basket.basketWeek,
  });
  return true;
}

/**
 * Draft and payment-pending baskets expire at their deadline (the earliest cut-off), as payments
 * are voided at theirs and rounds close at theirs. A pending payment is voided through the
 * payments module (so it is logged and its fees reconciled); nothing is charged. Each basket has
 * its own transaction; one that fails is logged and counted in `failed`, and the rest still
 * expire.
 */
export async function expireBaskets(deps: AppDeps): Promise<{ expired: number; failed: number }> {
  const now = (await resolveClock(deps)).now();
  const due = await deps.prisma.weeklyBasket.findMany({
    where: { status: { in: ['draft', 'payment_pending'] }, deadlineAt: { lte: now } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let expired = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const done = await withTransaction(deps, systemCaller('expire baskets'), async (ctx) => {
        // The basket first; voidPayment then share-locks the payment's rounds, the shop and the
        // payment. Only a close takes a round for update, and a close never waits for a basket.
        await ctx.tx.$queryRaw`SELECT id FROM weekly_baskets WHERE id = ${id}::uuid FOR UPDATE`;
        const basket = await ctx.tx.weeklyBasket.findUniqueOrThrow({ where: { id } });
        if (
          (basket.status !== 'draft' && basket.status !== 'payment_pending') ||
          basket.deadlineAt.getTime() > ctx.now.getTime()
        ) {
          return false;
        }
        return expireBasketIn(ctx, basket);
      });
      if (done) expired += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `Expiring basket ${id} failed:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { expired, failed };
}
