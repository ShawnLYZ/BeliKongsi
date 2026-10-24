import type { Participation, Round } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { freePickupsOf } from '@/server/modules/fulfilment/plan';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { notify, TEMPLATES, type NotifyInput } from '@/server/modules/notifications/notify';
import { refundDeliveryFeeIfUnused } from '@/server/modules/payments/delivery-fees';
import { lockShop } from '@/server/modules/payments/fee';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound, unprocessable } from '@/server/platform/errors';
import { requireOps } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { openNextRound } from './open';

/** The round, locked FOR UPDATE and read with its product; 404 when it does not exist. */
async function lockRound(ctx: TxContext, roundId: string) {
  const locked = await ctx.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`;
  if (locked.length === 0) throw notFound('Round');
  return ctx.tx.round.findUniqueOrThrow({ where: { id: roundId }, include: { product: true } });
}

/**
 * The refund path both round cancellations share, on a round the caller has already locked: lock
 * the lines in `lineStatus` (in id order), then their shops in id order; refund each line in full
 * out of the round hold (`amountOf` sen); give back delivery fees nothing needs any more; free
 * pickups; mark the round cancelled; call `onCancelled` with the total; then log and emit
 * `refund.issued` per shop and send the owner notice `noticeFor` builds (never to background shops).
 */
async function refundAndCancelRound(
  ctx: TxContext,
  round: Round,
  input: {
    lineStatus: 'kept' | 'active';
    amountOf: (line: Participation) => number;
    reason: string;
    onCancelled: (refundedSen: number) => Promise<void>;
    noticeFor: (shopId: string, amountSen: number) => NotifyInput;
  },
): Promise<{ refundedSen: number }> {
  const { tx, now } = ctx;
  const roundId = round.id;
  const lockedParts =
    input.lineStatus === 'kept'
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM participations WHERE round_id = ${roundId}::uuid AND status = 'kept'
          ORDER BY id FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM participations WHERE round_id = ${roundId}::uuid AND status = 'active'
          ORDER BY id FOR UPDATE`;
  const lines = await tx.participation.findMany({
    where: { id: { in: lockedParts.map((r) => r.id) } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const shopIds = [...new Set(lines.map((p) => p.shopId))].sort();
  for (const shopId of shopIds) await lockShop(ctx, shopId);

  const refundByShop = new Map<string, number>();
  for (const p of lines) {
    const amountSen = input.amountOf(p);
    await tx.participation.update({
      where: { id: p.id },
      data: { status: 'refunded_round_cancelled', outcomeReason: input.reason, updatedAt: now },
    });
    if (amountSen > 0) {
      await post(ctx, {
        from: { kind: 'round_hold', roundId },
        to: { kind: 'shop_balance', shopId: p.shopId },
        amountSen,
        kind: 'refund_round_cancelled',
        refs: { roundId, participationId: p.id, paymentId: p.paymentId, shopId: p.shopId },
      });
    }
    refundByShop.set(p.shopId, (refundByShop.get(p.shopId) ?? 0) + amountSen);
  }

  // Delivery fees no door line needs now (the lines above no longer count).
  const feeDates = [
    ...new Map(
      lines
        .filter((p) => p.destinationType === 'door')
        .map((p) => [`${p.shopId}|${p.deliveryDate}`, p]),
    ).values(),
  ].sort((a, b) =>
    a.shopId === b.shopId
      ? a.deliveryDate.localeCompare(b.deliveryDate)
      : a.shopId.localeCompare(b.shopId),
  );
  for (const p of feeDates) await refundDeliveryFeeIfUnused(ctx, p.shopId, p.deliveryDate);

  // A refunded line no longer holds back its shop's pickup for that place and date (C4).
  // After the shop locks, like the hub check: a concurrent status move then sees this cancel.
  await freePickupsOf(ctx, lines);

  await tx.round.update({ where: { id: roundId }, data: { status: 'cancelled' } });
  let refundedSen = 0;
  for (const amountSen of refundByShop.values()) refundedSen += amountSen;
  await input.onCancelled(refundedSen);

  const owners = await tx.shop.findMany({
    where: { id: { in: shopIds }, isBackground: false },
    select: { id: true },
  });
  const ownerShopIds = new Set(owners.map((s) => s.id));
  for (const shopId of shopIds) {
    const amountSen = refundByShop.get(shopId) ?? 0;
    await appendLog(ctx, {
      action: 'refund.issued',
      subjectType: 'shop',
      subjectId: shopId,
      scope: { shopId },
      after: { amountSen, kind: 'full', roundId },
      reason: input.reason,
    });
    await emitEvent(ctx, 'refund.issued', {
      shopId,
      amountSen,
      kind: 'full',
      referenceId: roundId,
    });
    if (ownerShopIds.has(shopId)) await notify(ctx, input.noticeFor(shopId, amountSen));
  }
  return { refundedSen };
}

/**
 * Cancels a round after its cut-off because Ops or the supplier turned the order down (PRD 12):
 * every kept line is refunded in full out of the round hold, delivery fees nothing needs any more
 * go back, the round is cancelled, and each shop's owner is told what came back. Runs inside the
 * caller's transaction, with the same lock order as a close: round, lines, shops in id order, then
 * the ledger. The caller logs the decision itself (the round has no log action of its own).
 * Returns the sen refunded in all.
 */
export async function cancelRoundWithRefunds(
  ctx: TxContext,
  roundId: string,
  input: { by: 'ops' | 'supplier'; reason: string },
): Promise<{ refundedSen: number }> {
  const round = await lockRound(ctx, roundId);
  return refundAndCancelRound(ctx, round, {
    lineStatus: 'kept',
    amountOf: (p) => (p.finalAllInSen ?? 0) * p.quantity,
    reason: input.reason,
    onCancelled: async () => {
      await emitEvent(ctx, 'round.cancelled', {
        roundId,
        by: input.by,
        reasonCode: input.by === 'ops' ? 'ops_rejected' : 'supplier_rejected',
      });
    },
    noticeFor: (shopId, amountSen) => ({
      type: 'owner.order_rejected',
      audience: { shopId, roles: ['owner'] },
      link: '/owner/kongsi',
      message: TEMPLATES['owner.order_rejected']({
        by: input.by,
        shortName: round.product.shortName,
        refundSen: amountSen,
      }),
      dedupeKey: `owner.order_rejected:${roundId}:${shopId}`,
    }),
  });
}

/**
 * Ops cancels a round that is still open, in an emergency (P1-18): every active line is refunded
 * in full out of the round hold, delivery fees nothing needs any more go back, the round is
 * cancelled and each owner is told why. The next round opens at this round's cut-off unless Ops
 * also pause the product. It takes the round lock first, like the cut-off close, so exactly one
 * of the two happens; unlike the close it ignores the cut-off, so an open round past its cut-off
 * that nobody has closed yet can still be cancelled.
 */
export async function cancelOpenRound(
  deps: AppDeps,
  caller: Caller,
  roundId: string,
  input: { reason?: string; pauseProduct?: boolean },
): Promise<{ refundedSen: number; nextRoundId: string | null }> {
  return withTransaction(deps, caller, async (ctx) => {
    requireOps(caller);
    const reason = input.reason?.trim();
    if (!reason) throw unprocessable('REASON_REQUIRED', 'Please give a reason for cancelling.');

    const round = await lockRound(ctx, roundId);
    if (round.status !== 'open') {
      throw conflict('ROUND_NOT_OPEN', 'This Kongsi is no longer open, so it cannot be cancelled.');
    }
    const { refundedSen } = await refundAndCancelRound(ctx, round, {
      lineStatus: 'active',
      amountOf: (p) => p.paidSen,
      reason,
      onCancelled: async () => {
        await emitEvent(ctx, 'round.cancelled', { roundId, by: 'ops', reasonCode: 'emergency' });
      },
      noticeFor: (shopId, amountSen) => ({
        type: 'round.cancelled_emergency',
        audience: { shopId, roles: ['owner'] },
        link: '/owner/kongsi',
        message: TEMPLATES['round.cancelled_emergency']({
          shortName: round.product.shortName,
          reason,
          refundSen: amountSen,
        }),
        dedupeKey: `round.cancelled_emergency:${roundId}:${shopId}`,
      }),
    });

    const pauseProduct = input.pauseProduct === true;
    let nextRoundId: string | null = null;
    if (pauseProduct) {
      await ctx.tx.product.update({ where: { id: round.productId }, data: { active: false } });
    } else if (round.product.active) {
      nextRoundId = (await openNextRound(ctx, round.productId, round.cutoffAt)).id;
    }
    // Logged once the outcome is known, so the entry records the pause and the next round too.
    await appendLog(ctx, {
      action: 'round.cancelled',
      subjectType: 'round',
      subjectId: roundId,
      scope: { supplierId: round.supplierId, operator: true },
      before: { status: 'open' },
      after: { refundedSen, pauseProduct, nextRoundId },
      reason,
    });
    return { refundedSen, nextRoundId };
  });
}
