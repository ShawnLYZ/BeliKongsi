import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { refundDeliveryFeeIfUnused } from '@/server/modules/payments/delivery-fees';
import { lockShop } from '@/server/modules/payments/fee';
import { notFound } from '@/server/platform/errors';
import type { TxContext } from '@/server/platform/tx';

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
  const { tx, now } = ctx;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`;
  if (locked.length === 0) throw notFound('Round');
  const round = await tx.round.findUniqueOrThrow({
    where: { id: roundId },
    include: { product: true },
  });

  const lockedParts = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM participations WHERE round_id = ${roundId}::uuid AND status = 'kept'
    ORDER BY id FOR UPDATE`;
  const kept = await tx.participation.findMany({
    where: { id: { in: lockedParts.map((r) => r.id) } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const shopIds = [...new Set(kept.map((p) => p.shopId))].sort();
  for (const shopId of shopIds) await lockShop(ctx, shopId);

  const refundByShop = new Map<string, number>();
  for (const p of kept) {
    const amountSen = (p.finalAllInSen ?? 0) * p.quantity;
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

  // Delivery fees no door line needs now (the lines above are no longer kept).
  const feeDates = [
    ...new Map(
      kept
        .filter((p) => p.destinationType === 'door')
        .map((p) => [`${p.shopId}|${p.deliveryDate}`, p]),
    ).values(),
  ].sort((a, b) =>
    a.shopId === b.shopId
      ? a.deliveryDate.localeCompare(b.deliveryDate)
      : a.shopId.localeCompare(b.shopId),
  );
  for (const p of feeDates) await refundDeliveryFeeIfUnused(ctx, p.shopId, p.deliveryDate);

  await tx.round.update({ where: { id: roundId }, data: { status: 'cancelled' } });
  await emitEvent(ctx, 'round.cancelled', {
    roundId,
    by: input.by,
    reasonCode: input.by === 'ops' ? 'ops_rejected' : 'supplier_rejected',
  });

  const owners = await tx.shop.findMany({
    where: { id: { in: shopIds }, isBackground: false },
    select: { id: true },
  });
  const ownerShopIds = new Set(owners.map((s) => s.id));
  let refundedSen = 0;
  for (const shopId of shopIds) {
    const amountSen = refundByShop.get(shopId) ?? 0;
    refundedSen += amountSen;
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
    if (!ownerShopIds.has(shopId)) continue;
    await notify(ctx, {
      type: 'owner.order_rejected',
      audience: { shopId, roles: ['owner'] },
      link: '/owner/kongsi',
      message: TEMPLATES['owner.order_rejected']({
        by: input.by,
        shortName: round.product.shortName,
        refundSen: amountSen,
      }),
      dedupeKey: `owner.order_rejected:${roundId}:${shopId}`,
    });
  }
  return { refundedSen };
}
