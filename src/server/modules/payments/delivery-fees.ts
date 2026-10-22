import type { ParticipationStatus } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import type { TxContext } from '@/server/platform/tx';
import { lockShop } from './fee';

/** Participation statuses still heading for a delivery: their door date still needs its fee. */
const HEADING_FOR_DELIVERY: ParticipationStatus[] = [
  'active',
  'kept',
  'allocated',
  'received',
  'closed',
];

/**
 * Gives back the delivery fee held for a shop's door date once nothing needs it (PRD 6.9): no door
 * line of the shop for that date is still heading for delivery, and no pending payment with a
 * door line for it is still before its deadline (that payment would be left without a fee if it
 * succeeded). Takes the shop lock (the payments lock order) so it never races a payment of the
 * same shop. Returns the sen refunded to the shop balance: the fee, or 0 when nothing moved.
 */
export async function refundDeliveryFeeIfUnused(
  ctx: TxContext,
  shopId: string,
  deliveryDate: string,
): Promise<number> {
  const { tx } = ctx;
  await lockShop(ctx, shopId);
  const charge = await tx.deliveryFeeCharge.findUnique({
    where: { shopId_deliveryDate: { shopId, deliveryDate } },
  });
  if (!charge || charge.status !== 'held') return 0;
  const stillDoor = await tx.participation.count({
    where: {
      shopId,
      deliveryDate,
      destinationType: 'door',
      status: { in: HEADING_FOR_DELIVERY },
    },
  });
  if (stillDoor > 0) return 0;
  // A pending payment past its deadline can no longer succeed, so it no longer needs the fee.
  const pendingDoor = await tx.payment.count({
    where: {
      shopId,
      status: 'pending',
      deadlineAt: { gt: ctx.now },
      lines: { some: { deliveryDate, destinationType: 'door' } },
    },
  });
  if (pendingDoor > 0) return 0;

  await post(ctx, {
    from: { kind: 'delivery_fee_hold', shopId, deliveryDate },
    to: { kind: 'shop_balance', shopId },
    amountSen: charge.amountSen,
    kind: 'refund_delivery_fee',
    refs: { paymentId: charge.paymentId, shopId },
    memo: `The delivery fee for ${deliveryDate} went back: no door lines are left.`,
  });
  await tx.deliveryFeeCharge.update({ where: { id: charge.id }, data: { status: 'refunded' } });
  await appendLog(ctx, {
    action: 'refund.issued',
    subjectType: 'delivery_fee_charge',
    subjectId: charge.id,
    scope: { shopId },
    after: { amountSen: charge.amountSen, kind: 'delivery_fee', date: deliveryDate },
  });
  await emitEvent(ctx, 'refund.issued', {
    shopId,
    amountSen: charge.amountSen,
    kind: 'delivery_fee',
    referenceId: charge.id,
  });
  return charge.amountSen;
}

/** Gives back the fee for each door date a payment had lines for, after it failed or was voided. */
export async function reconcilePaymentFees(ctx: TxContext, paymentId: string): Promise<void> {
  const { tx } = ctx;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const lines = await tx.paymentLine.findMany({
    where: { paymentId, destinationType: 'door' },
    select: { deliveryDate: true },
  });
  for (const date of [...new Set(lines.map((l) => l.deliveryDate))].sort()) {
    await refundDeliveryFeeIfUnused(ctx, payment.shopId, date);
  }
}
