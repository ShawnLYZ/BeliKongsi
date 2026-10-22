import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import type { TxContext } from '@/server/platform/tx';

/**
 * Locks the shop row for the rest of the transaction. Creating, settling, failing, voiding and
 * cancelling all take this lock first, so they run one after another per shop and always lock
 * ledger accounts in the same order.
 */
export async function lockShop(ctx: TxContext, shopId: string): Promise<void> {
  if (!UUID.test(shopId)) throw notFound('Shop');
  const rows = await ctx.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM shops WHERE id = ${shopId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound('Shop');
}

/**
 * Gives back the delivery fee held for a door date once nothing needs it: no active door line for
 * that date and no pending payment, still before its deadline, with a door line for it (that
 * payment would be left without a fee if it succeeded). Returns the amount refunded to the shop balance, 0 when nothing moved.
 */
export async function reconcileDeliveryFee(
  ctx: TxContext,
  shopId: string,
  deliveryDate: string,
): Promise<number> {
  const { tx } = ctx;
  const charge = await tx.deliveryFeeCharge.findUnique({
    where: { shopId_deliveryDate: { shopId, deliveryDate } },
  });
  if (!charge || charge.status !== 'held') return 0;
  const activeDoor = await tx.participation.count({
    where: { shopId, deliveryDate, destinationType: 'door', status: 'active' },
  });
  if (activeDoor > 0) return 0;
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

/** Reconciles each door date a payment had lines for, after it failed or was voided. */
export async function reconcilePaymentFees(ctx: TxContext, paymentId: string): Promise<void> {
  const { tx } = ctx;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const lines = await tx.paymentLine.findMany({
    where: { paymentId, destinationType: 'door' },
    select: { deliveryDate: true },
  });
  for (const date of [...new Set(lines.map((l) => l.deliveryDate))].sort()) {
    await reconcileDeliveryFee(ctx, payment.shopId, date);
  }
}
