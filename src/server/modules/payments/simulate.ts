import type { Payment } from '@/generated/prisma/client';
import type { PaymentView } from '@/lib/views/payments';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { completePaymentSuccess, failPayment, lockPayment, voidPayment } from './complete';
import { checkoutUrlOf } from './create';

export function paymentView(p: Payment): PaymentView {
  return {
    paymentId: p.id,
    status: p.status,
    linesTotalSen: p.linesTotalSen,
    deliveryFeeSen: p.deliveryFeeSen,
    totalSen: p.totalSen,
    balanceAppliedSen: p.balanceAppliedSen,
    externalSen: p.externalSen,
    checkoutUrl: checkoutUrlOf(p),
    method: p.method,
    partnerReference: p.partnerReference,
    purpose: p.purpose,
    basketId: p.basketId,
    shopId: p.shopId,
    deadlineAt: p.deadlineAt.toISOString(),
  };
}

export type SimulatedResult = { outcome: 'succeeded' | 'failed'; method: 'duitnow_qr' | 'fpx' };

/**
 * The simulated checkout's answer for a pending payment, for the owner of the payment's shop. A
 * payment that is no longer pending is returned unchanged. A result at or after the deadline (a
 * join's deadline is its round's cut-off, the instant the round closes) voids the payment, as does
 * a success for a round that has already closed: the void is committed first, then the call
 * answers 409 PAYMENT_VOIDED.
 */
export async function simulatePaymentResult(
  deps: AppDeps,
  caller: Caller,
  paymentId: string,
  result: SimulatedResult,
): Promise<PaymentView> {
  if (!UUID.test(paymentId)) throw notFound('Payment');

  const outcome = await withTransaction(deps, caller, async (ctx) => {
    const found = await ctx.tx.payment.findUnique({ where: { id: paymentId } });
    if (!found) throw notFound('Payment');
    // Another shop's people get 404; this shop's staff, and Ops, get 403.
    requireShopAccess(caller, found.shopId, ['owner']);
    const p = await lockPayment(ctx, paymentId);
    if (p.status !== 'pending') return { voided: false, view: paymentView(p) };
    if (ctx.now.getTime() >= p.deadlineAt.getTime()) {
      await voidPayment(ctx, p.id);
      return { voided: true, view: null };
    }
    if (result.outcome === 'succeeded') await completePaymentSuccess(ctx, p.id, result.method);
    else await failPayment(ctx, p.id);
    const after = await ctx.tx.payment.findUniqueOrThrow({ where: { id: p.id } });
    // settlePayment voids a payment whose round closed before the money arrived.
    if (after.status === 'voided') return { voided: true, view: null };
    return { voided: false, view: paymentView(after) };
  });
  // Thrown after the transaction so the void stays committed.
  if (outcome.voided || !outcome.view) {
    throw conflict('PAYMENT_VOIDED', 'This payment arrived after the deadline and was voided.');
  }
  return outcome.view;
}
