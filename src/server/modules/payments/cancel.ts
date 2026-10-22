import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { lockShop, reconcileDeliveryFee } from './fee';

/**
 * An owner cancels a line before the round's cut-off (story 57). The whole amount paid goes back
 * to the shop balance. When no other active door line is left for that delivery date, the
 * delivery fee held for the date goes back too (PRD 6.9).
 */
export async function cancelParticipation(
  deps: AppDeps,
  caller: Caller,
  participationId: string,
): Promise<{ refundSen: number; deliveryFeeRefundSen: number }> {
  if (!UUID.test(participationId)) throw notFound('Participation');
  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    // Lock the shop first, as createPayment and settlement do, so a cancel and a payment for the
    // same shop run one after another and lock ledger accounts in the same order.
    const owner = await tx.participation.findUnique({
      where: { id: participationId },
      select: { shopId: true },
    });
    if (!owner) throw notFound('Participation');
    await lockShop(ctx, owner.shopId);
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM participations WHERE id = ${participationId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Participation');
    const part = await tx.participation.findUniqueOrThrow({
      where: { id: participationId },
      include: { round: { include: { product: true } } },
    });
    // Another shop's participation is a 404; this shop's staff and Ops get 403.
    requireShopAccess(caller, part.shopId, ['owner']);
    if (
      part.status !== 'active' ||
      part.round.status !== 'open' ||
      part.round.cutoffAt.getTime() <= now.getTime()
    ) {
      throw conflict('ROUND_CLOSED', 'This line can no longer be cancelled.');
    }
    const shopId = part.shopId;

    await tx.participation.update({
      where: { id: part.id },
      data: { status: 'cancelled', outcomeReason: 'Cancelled by the owner.', updatedAt: now },
    });
    await post(ctx, {
      from: { kind: 'round_hold', roundId: part.roundId },
      to: { kind: 'shop_balance', shopId },
      amountSen: part.paidSen,
      kind: 'refund_cancelled',
      refs: {
        roundId: part.roundId,
        participationId: part.id,
        paymentId: part.paymentId,
        shopId,
      },
    });

    // The delivery fee goes back when nothing needs it any more (active door line or pending
    // door payment for that date).
    const deliveryFeeRefundSen =
      part.destinationType === 'door'
        ? await reconcileDeliveryFee(ctx, shopId, part.deliveryDate)
        : 0;

    const scope = { shopId };
    await appendLog(ctx, {
      action: 'participation.cancelled',
      subjectType: 'participation',
      subjectId: part.id,
      scope,
      before: { status: 'active' },
      after: { status: 'cancelled', roundId: part.roundId, quantity: part.quantity },
    });
    await appendLog(ctx, {
      action: 'refund.issued',
      subjectType: 'participation',
      subjectId: part.id,
      scope,
      after: { amountSen: part.paidSen, kind: 'full' },
    });
    await emitEvent(ctx, 'participation.cancelled', {
      participationId: part.id,
      roundId: part.roundId,
      shopId,
      quantity: part.quantity,
    });
    await emitEvent(ctx, 'refund.issued', {
      shopId,
      amountSen: part.paidSen,
      kind: 'full',
      referenceId: part.id,
    });
    await notify(ctx, {
      type: 'participation.cancelled',
      audience: { shopId, roles: ['owner'] },
      link: '/owner/kongsi',
      message: TEMPLATES['participation.cancelled']({
        quantity: part.quantity,
        unitName: part.round.product.unitName,
        shortName: part.round.product.shortName,
        refundSen: part.paidSen + deliveryFeeRefundSen,
      }),
      dedupeKey: `participation.cancelled:${part.id}`,
    });
    return { refundSen: part.paidSen, deliveryFeeRefundSen };
  });
}
