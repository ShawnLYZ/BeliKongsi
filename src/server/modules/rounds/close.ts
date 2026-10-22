import type { PostingKind, Prisma } from '@/generated/prisma/client';
import { resolveClock } from '@/server/adapters/clock';
import { closeRound, type CloseOutcome, type CloseRoundResult, type Tier } from '@/server/engine';
import { appendLog } from '@/server/modules/activity/log';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { refundDeliveryFeeIfUnused } from '@/server/modules/payments/delivery-fees';
import { lockShop } from '@/server/modules/payments/fee';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction } from '@/server/platform/tx';
import { draftSupplierOrder } from '@/server/modules/supplier-orders/draft';
import { openNextRound } from './open';

export type CloseRoundOutcome = CloseRoundResult['status'] | 'skipped';

const REFUND: Record<CloseOutcome, { posting: PostingKind; kind: 'difference' | 'full' }> = {
  kept: { posting: 'refund_difference', kind: 'difference' },
  dropped_price_limit: { posting: 'refund_dropped', kind: 'full' },
  refunded_failed: { posting: 'refund_failed', kind: 'full' },
};

/**
 * Closes one round at its cut-off (PRD 6.6, 8), in one transaction with every consequence: the
 * engine's outcome for each active participation, the refunds out of the round hold, delivery fees
 * nothing needs any more, the round's result, its log entries and events, and the next round.
 * Returns `skipped` when the round is not open or its cut-off is still ahead, so running it again,
 * or from two workers at once, changes nothing.
 */
export async function closeRoundById(
  deps: AppDeps,
  roundId: string,
): Promise<{ outcome: CloseRoundOutcome }> {
  return withTransaction(deps, systemCaller('close rounds'), async (ctx) => {
    const { tx, now } = ctx;
    // 1. Lock the round before reading its status: a second close waits here, then skips.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`;
    if (locked.length === 0) return { outcome: 'skipped' };
    const round = await tx.round.findUniqueOrThrow({
      where: { id: roundId },
      include: { product: true },
    });
    if (round.status !== 'open' || round.cutoffAt.getTime() > now.getTime()) {
      return { outcome: 'skipped' };
    }

    // Lock the active lines too, so a cancel still in flight either finishes first (and its line
    // is no longer active here) or waits for the close (and then finds the round closed).
    const lockedParts = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM participations WHERE round_id = ${roundId}::uuid AND status = 'active'
      ORDER BY id FOR UPDATE`;
    const parts = await tx.participation.findMany({
      where: { id: { in: lockedParts.map((r) => r.id) } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });

    // 2. The engine decides every outcome.
    const tiers = round.tiersSnapshot as unknown as Tier[];
    const result = closeRound({
      tiers,
      feeBps: round.feeBps,
      unitName: round.product.unitName,
      participants: parts.map((p) => ({
        id: p.id,
        quantity: p.quantity,
        joinedAt: p.joinedAt.toISOString(),
        unitShippingSen: p.unitShippingSen,
        priceLimitSen: p.priceLimitSen,
        paidSen: p.paidSen,
      })),
    });
    const byId = new Map(parts.map((p) => [p.id, p]));

    // Door dates whose lines were refunded may no longer need their delivery fee.
    const feeDates = [
      ...new Map(
        result.participants
          .filter((r) => r.outcome !== 'kept')
          .map((r) => byId.get(r.id)!)
          .filter((p) => p.destinationType === 'door')
          .map((p) => [`${p.shopId}|${p.deliveryDate}`, p]),
      ).values(),
    ].sort((a, b) =>
      a.shopId === b.shopId
        ? a.deliveryDate.localeCompare(b.deliveryDate)
        : a.shopId.localeCompare(b.shopId),
    );
    // Every shop this close posts to (a refund, or a delivery fee back) is locked now, in id order,
    // before any posting: the payments lock order is round, shop, then accounts (see lockRounds).
    const postedShops = new Set([
      ...result.participants.filter((r) => r.refundSen > 0).map((r) => byId.get(r.id)!.shopId),
      ...feeDates.map((p) => p.shopId),
    ]);
    for (const shopId of [...postedShops].sort()) await lockShop(ctx, shopId);

    for (const r of result.participants) {
      const p = byId.get(r.id)!;
      // 3. The participation's outcome and final amounts.
      await tx.participation.update({
        where: { id: p.id },
        data: {
          status: r.outcome,
          finalGoodsSen: r.final?.goodsSen ?? null,
          finalFeeSen: r.final?.feeSen ?? null,
          finalAllInSen: r.final?.allInSen ?? null,
          outcomeReason: r.reason,
          updatedAt: now,
        },
      });
      const scope = { shopId: p.shopId };
      if (r.outcome === 'dropped_price_limit') {
        await appendLog(ctx, {
          action: 'participation.dropped_price_limit',
          subjectType: 'participation',
          subjectId: p.id,
          scope,
          before: { status: 'active' },
          after: {
            status: r.outcome,
            roundId: round.id,
            quantity: p.quantity,
            finalAllInSen: r.final?.allInSen ?? null,
            priceLimitSen: p.priceLimitSen,
          },
        });
        await emitEvent(ctx, 'participation.dropped', {
          participationId: p.id,
          roundId: round.id,
          shopId: p.shopId,
          quantity: p.quantity,
          outcome: r.outcome,
        });
      }
      // 4. The refund out of the round hold: the difference, or the whole amount.
      if (r.refundSen > 0) {
        const { posting, kind } = REFUND[r.outcome];
        await post(ctx, {
          from: { kind: 'round_hold', roundId: round.id },
          to: { kind: 'shop_balance', shopId: p.shopId },
          amountSen: r.refundSen,
          kind: posting,
          refs: {
            roundId: round.id,
            participationId: p.id,
            paymentId: p.paymentId,
            shopId: p.shopId,
          },
        });
        await appendLog(ctx, {
          action: 'refund.issued',
          subjectType: 'participation',
          subjectId: p.id,
          scope,
          after: { amountSen: r.refundSen, kind, roundId: round.id },
        });
        await emitEvent(ctx, 'refund.issued', {
          shopId: p.shopId,
          amountSen: r.refundSen,
          kind,
          referenceId: p.id,
        });
      }
    }

    // 5. Delivery fees that no door line heading for that date needs any more (PRD 6.9).
    for (const p of feeDates) await refundDeliveryFeeIfUnused(ctx, p.shopId, p.deliveryDate);

    // 6. The round's result.
    await tx.round.update({
      where: { id: round.id },
      data: {
        status: result.status,
        finalTier: result.finalTier,
        finalUnitPriceSen: result.finalUnitPriceSen,
        totalAtCutoff: result.totalAtCutoff,
        totalKept: result.totalKept,
        closeIterations: result.iterations,
        closedAt: now,
      },
    });
    const shopCount = new Set(
      result.participants.filter((r) => r.outcome === 'kept').map((r) => byId.get(r.id)!.shopId),
    ).size;
    // 7–8. Its log entry and event.
    await appendLog(ctx, {
      action: 'round.closed',
      subjectType: 'round',
      subjectId: round.id,
      scope: { supplierId: round.supplierId, operator: true },
      before: { status: 'open' },
      after: {
        status: result.status,
        finalTier: result.finalTier,
        finalUnitPriceSen: result.finalUnitPriceSen,
        totalAtCutoff: result.totalAtCutoff,
        totalKept: result.totalKept,
        closeIterations: result.iterations,
        shopCount,
        refundSen: result.totals.refundSen,
      } as Prisma.InputJsonValue,
    });
    await emitEvent(ctx, 'round.closed', {
      roundId: round.id,
      outcome: result.status,
      finalTier: result.finalTier,
      finalUnitPriceSen: result.finalUnitPriceSen,
      totalKept: result.totalKept,
      shopCount,
    });

    // 9. A formed round's supplier order, waiting for Ops.
    if (result.status === 'formed') await draftSupplierOrder(ctx, round, result);

    // 10. The product's next round opens at this cut-off.
    const next = round.product.active
      ? await openNextRound(ctx, round.productId, round.cutoffAt)
      : null;

    // 11. The owners hear their results: one message per shop and outcome, summing its lines.
    // Background shops and staff are never told; an empty round has no lines to tell about.
    const shops = await tx.shop.findMany({
      where: { id: { in: [...new Set(parts.map((p) => p.shopId))] }, isBackground: false },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const { shortName, unitName } = round.product;
    for (const { id: shopId } of shops) {
      const mine = result.participants
        .map((r) => ({ r, p: byId.get(r.id)! }))
        .filter(({ p }) => p.shopId === shopId);
      for (const outcome of ['kept', 'dropped_price_limit', 'refunded_failed'] as const) {
        const group = mine.filter(({ r }) => r.outcome === outcome);
        if (group.length === 0) continue;
        const refundSen = group.reduce((sum, { r }) => sum + r.refundSen, 0);
        const first = group[0]!;
        const message =
          outcome === 'kept'
            ? TEMPLATES['round.kept']({
                shortName,
                unitName,
                finalUnitPriceSen: result.finalUnitPriceSen!,
                totalKept: result.totalKept,
                shopCount,
                refundSen,
                readyAt: round.expectedReadyAt,
              })
            : outcome === 'dropped_price_limit'
              ? TEMPLATES['round.dropped']({
                  shortName,
                  allInSen: first.r.final!.allInSen,
                  limitSen: first.p.priceLimitSen!,
                  refundSen,
                })
              : TEMPLATES['round.failed']({
                  shortName,
                  unitName,
                  minQuantity: tiers[0]!.minQuantity,
                  refundSen,
                  nextCutoff: next?.cutoffAt ?? null,
                });
        await notify(ctx, {
          type: `round.${outcome === 'kept' ? 'kept' : outcome === 'dropped_price_limit' ? 'dropped' : 'failed'}`,
          audience: { shopId, roles: ['owner'] },
          link: '/owner/kongsi',
          message,
          dedupeKey: `round.result:${round.id}:${shopId}:${outcome}`,
        });
      }
    }

    return { outcome: result.status };
  });
}

/**
 * Closes every open round whose cut-off has come, earliest cut-off first, one transaction each.
 * A round that fails to close is logged with its whole error, counted in `failed` and left open
 * for the next run; the rest still close.
 */
export async function closeDueRounds(deps: AppDeps): Promise<{ closed: number; failed: number }> {
  const now = (await resolveClock(deps)).now();
  const due = await deps.prisma.round.findMany({
    where: { status: 'open', cutoffAt: { lte: now } },
    select: { id: true },
    orderBy: [{ cutoffAt: 'asc' }, { id: 'asc' }],
  });
  let closed = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const { outcome } = await closeRoundById(deps, id);
      if (outcome !== 'skipped') closed += 1;
    } catch (error) {
      failed += 1;
      // The error itself, so its stack is logged: a round left open keeps its money held.
      console.error(`Closing round ${id} failed:`, error);
    }
  }
  return { closed, failed };
}
