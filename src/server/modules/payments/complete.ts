import type { ParticipationSource, Payment, PaymentMethod } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import type { AccountRef } from '@/server/modules/ledger/accounts';
import { post } from '@/server/modules/ledger/post';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { notFound } from '@/server/platform/errors';
import { reconcilePaymentFees } from './delivery-fees';
import { lockRounds, lockShop } from './fee';
import { UUID } from '@/server/platform/ids';
import type { TxContext } from '@/server/platform/tx';

/**
 * Share-locks the rounds of a payment's lines (see `lockRounds`). A line's round never changes, so
 * the ids are read before any lock is held.
 */
async function lockPaymentRounds(ctx: TxContext, paymentId: string) {
  const lines = await ctx.tx.paymentLine.findMany({
    where: { paymentId },
    select: { roundId: true },
  });
  return lockRounds(
    ctx,
    lines.map((l) => l.roundId),
  );
}

/**
 * Locks the payment row for the rest of the transaction, so two results cannot both apply. Lock
 * order (see `lockRounds`): the payment's rounds (shared), the basket row (when the payment has
 * one), the shop, then the payment.
 */
export async function lockPayment(ctx: TxContext, paymentId: string): Promise<Payment> {
  if (!UUID.test(paymentId)) throw notFound('Payment');
  const owner = await ctx.tx.payment.findUnique({
    where: { id: paymentId },
    select: { shopId: true, basketId: true },
  });
  if (!owner) throw notFound('Payment');
  await lockPaymentRounds(ctx, paymentId);
  if (owner.basketId) {
    await ctx.tx.$queryRaw`
      SELECT id FROM weekly_baskets WHERE id = ${owner.basketId}::uuid FOR UPDATE`;
  }
  await lockShop(ctx, owner.shopId);
  const locked = await ctx.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
  if (locked.length === 0) throw notFound('Payment');
  return ctx.tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

const sourceOf = (p: Payment): ParticipationSource =>
  p.purpose === 'basket' ? 'weekly_basket' : 'catalogue';

/**
 * Splits `amountSen` going into `to`: the balance first (as far as `left.sen` reaches), then
 * partner cash. Zero parts are not posted.
 */
async function payInto(
  ctx: TxContext,
  p: Payment,
  left: { sen: number },
  to: AccountRef,
  amountSen: number,
  partnerKind: 'payment_in' | 'delivery_fee_in',
  refs: { roundId?: string; participationId?: string },
): Promise<number> {
  const fromBalance = Math.min(left.sen, amountSen);
  left.sen -= fromBalance;
  const allRefs = { ...refs, paymentId: p.id, shopId: p.shopId };
  if (fromBalance > 0) {
    await post(ctx, {
      from: { kind: 'shop_balance', shopId: p.shopId },
      to,
      amountSen: fromBalance,
      kind: 'balance_applied',
      refs: allRefs,
    });
  }
  if (amountSen - fromBalance > 0) {
    await post(ctx, {
      from: { kind: 'partner_cash' },
      to,
      amountSen: amountSen - fromBalance,
      kind: partnerKind,
      refs: allRefs,
    });
  }
  return fromBalance;
}

/**
 * Completes a pending payment: the shop joins every line's round, the money moves into the round
 * holds and the delivery fee hold (balance first, line by line in round order, then the fees),
 * and a basket becomes paid. A payment that is no longer pending is left alone. A payment with a
 * line in a round that is no longer open, or whose cut-off has come, is voided instead: no money
 * goes into a closed round's hold.
 */
export async function settlePayment(
  ctx: TxContext,
  paymentId: string,
  method: PaymentMethod,
  source?: ParticipationSource,
  opts: { reason?: string } = {},
): Promise<void> {
  const { tx, now } = ctx;
  const p = await lockPayment(ctx, paymentId);
  if (p.status !== 'pending') return;

  // lockPayment share-locked the rounds before the shop, so a close in flight has finished and its
  // status is seen here, or it waits until this payment has joined.
  const rounds = await lockPaymentRounds(ctx, p.id);
  if (rounds.some((r) => r.status !== 'open' || r.cutoffAt.getTime() <= now.getTime())) {
    await voidPayment(ctx, p.id, 'The round closed before the payment arrived.');
    return;
  }

  await tx.payment.update({
    where: { id: p.id },
    data: { status: 'succeeded', method, completedAt: now },
  });
  await appendLog(ctx, {
    action: 'payment.succeeded',
    subjectType: 'payment',
    subjectId: p.id,
    scope: { shopId: p.shopId },
    before: { status: 'pending' },
    after: {
      status: 'succeeded',
      method,
      totalSen: p.totalSen,
      balanceAppliedSen: p.balanceAppliedSen,
      externalSen: p.externalSen,
    },
  });

  const left = { sen: p.balanceAppliedSen };
  const lines = await tx.paymentLine.findMany({
    where: { paymentId: p.id },
    orderBy: [{ roundId: 'asc' }, { id: 'asc' }],
  });
  const joined: { id: string; roundId: string; quantity: number }[] = [];
  for (const line of lines) {
    const participation = await tx.participation.create({
      data: {
        roundId: line.roundId,
        shopId: p.shopId,
        paymentId: p.id,
        paymentLineId: line.id,
        basketLineId: line.basketLineId,
        quantity: line.quantity,
        priceLimitSen: line.priceLimitSen,
        fulfilment: line.fulfilment,
        destinationType: line.destinationType,
        pickupPointId: line.pickupPointId,
        deliveryDate: line.deliveryDate,
        joinedAt: now,
        source: source ?? sourceOf(p),
        unitShippingSen: line.unitShippingSen,
        baselineSen: line.baselineSen,
        baselineKind: line.baselineKind,
        startingAllInSen: line.unitAllInSen,
        paidSen: line.lineSen,
        status: 'active',
        updatedAt: now,
      },
    });
    await payInto(
      ctx,
      p,
      left,
      { kind: 'round_hold', roundId: line.roundId },
      line.lineSen,
      'payment_in',
      { roundId: line.roundId, participationId: participation.id },
    );
    joined.push({ id: participation.id, roundId: line.roundId, quantity: line.quantity });
  }

  // The delivery fee: an equal share for each date the payment carries it for (PRD 6.9).
  const dates = p.deliveryFeeDates;
  for (const [i, date] of dates.entries()) {
    const feeSen =
      Math.floor(p.deliveryFeeSen / dates.length) + (i < p.deliveryFeeSen % dates.length ? 1 : 0);
    if (feeSen <= 0) continue;
    const hold: AccountRef = { kind: 'delivery_fee_hold', shopId: p.shopId, deliveryDate: date };
    await payInto(ctx, p, left, hold, feeSen, 'delivery_fee_in', {});
    const where = { shopId_deliveryDate: { shopId: p.shopId, deliveryDate: date } };
    const charge = await tx.deliveryFeeCharge.findUnique({ where });
    if (!charge) {
      await tx.deliveryFeeCharge.create({
        data: {
          shopId: p.shopId,
          deliveryDate: date,
          amountSen: feeSen,
          paymentId: p.id,
          status: 'held',
        },
      });
    } else if (charge.status === 'refunded') {
      await tx.deliveryFeeCharge.update({
        where,
        data: { amountSen: feeSen, paymentId: p.id, status: 'held' },
      });
    } else {
      // Another payment already holds this date's fee: this one goes back to the balance.
      await post(ctx, {
        from: hold,
        to: { kind: 'shop_balance', shopId: p.shopId },
        amountSen: feeSen,
        kind: 'refund_delivery_fee',
        refs: { paymentId: p.id, shopId: p.shopId },
        memo: `The delivery fee for ${date} was already paid.`,
      });
    }
  }
  if (left.sen !== 0) {
    throw new Error(`Payment ${p.id}: ${left.sen} sen of the balance was not applied.`);
  }

  if (p.balanceAppliedSen > 0) {
    await appendLog(ctx, {
      action: 'balance.applied',
      subjectType: 'payment',
      subjectId: p.id,
      scope: { shopId: p.shopId },
      after: { amountSen: p.balanceAppliedSen },
    });
  }
  for (const j of joined) {
    await appendLog(ctx, {
      action: 'participation.joined',
      subjectType: 'participation',
      subjectId: j.id,
      scope: { shopId: p.shopId },
      after: { roundId: j.roundId, quantity: j.quantity, paymentId: p.id },
    });
    await emitEvent(ctx, 'participation.joined', {
      participationId: j.id,
      roundId: j.roundId,
      shopId: p.shopId,
      quantity: j.quantity,
      outcome: 'active',
    });
  }

  if (p.basketId) {
    const basket = await tx.weeklyBasket.update({
      where: { id: p.basketId },
      data: { status: 'paid', approvedAt: now, approvedByUserId: p.createdByUserId },
    });
    if (basket.approvalRequestId) {
      await tx.approvalRequest.update({
        where: { id: basket.approvalRequestId },
        data: {
          status: 'approved',
          decidedByUserId: p.createdByUserId,
          decidedAt: now,
          amountSen: p.totalSen,
        },
      });
    }
    await appendLog(ctx, {
      action: 'basket.approved',
      subjectType: 'weekly_basket',
      subjectId: basket.id,
      scope: { shopId: p.shopId },
      ...(opts.reason ? { reason: opts.reason } : {}),
      before: { status: 'payment_pending' },
      after: { status: 'paid', paymentId: p.id, lineCount: lines.length, amountSen: p.totalSen },
    });
    await emitEvent(ctx, 'basket.approved', {
      basketId: basket.id,
      shopId: p.shopId,
      week: basket.basketWeek,
      lineCount: lines.length,
      amountSen: p.totalSen,
    });
  }

  let message;
  if (p.purpose === 'basket' || lines.length !== 1) {
    message = TEMPLATES['payment.succeeded']({ kind: 'basket', roundCount: lines.length });
  } else {
    const round = await tx.round.findUniqueOrThrow({
      where: { id: lines[0]!.roundId },
      include: { product: true },
    });
    message = TEMPLATES['payment.succeeded']({ kind: 'join', shortName: round.product.shortName });
  }
  await notify(ctx, {
    type: 'payment.succeeded',
    audience: { shopId: p.shopId, roles: ['owner'] },
    link: `/owner/receipts/${p.id}`,
    message,
    dedupeKey: `payment.succeeded:${p.id}`,
  });
}

/** A simulated (or real) partner confirmed the money: see `settlePayment`. */
export async function completePaymentSuccess(
  ctx: TxContext,
  paymentId: string,
  method: PaymentMethod,
): Promise<void> {
  await settlePayment(ctx, paymentId, method);
}

/**
 * The partner refused the money: nothing is posted and a basket goes back to draft. A join payment
 * `superseded` by a new tap on the same round fails the same way, without telling the owner.
 */
export async function failPayment(
  ctx: TxContext,
  paymentId: string,
  opts: { superseded?: boolean } = {},
): Promise<void> {
  const { tx, now } = ctx;
  const p = await lockPayment(ctx, paymentId);
  if (p.status !== 'pending') return;
  await tx.payment.update({ where: { id: p.id }, data: { status: 'failed', completedAt: now } });
  if (p.basketId) {
    await tx.weeklyBasket.updateMany({
      where: { id: p.basketId, status: 'payment_pending' },
      data: { status: 'draft' },
    });
  }
  await appendLog(ctx, {
    action: 'payment.failed',
    subjectType: 'payment',
    subjectId: p.id,
    scope: { shopId: p.shopId },
    before: { status: 'pending' },
    after: { status: 'failed', basketId: p.basketId },
    ...(opts.superseded ? { reason: 'The owner started a new payment for the same round.' } : {}),
  });
  await reconcilePaymentFees(ctx, p.id);
  if (opts.superseded) return;
  let message;
  if (p.purpose === 'join') {
    const line = await tx.paymentLine.findFirstOrThrow({
      where: { paymentId: p.id },
      orderBy: { id: 'asc' },
    });
    const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
    message = TEMPLATES['payment.failed']({ kind: 'join', shortName: product.shortName });
  } else {
    message = TEMPLATES['payment.failed']({ kind: 'basket' });
  }
  await notify(ctx, {
    type: 'payment.failed',
    audience: { shopId: p.shopId, roles: ['owner'] },
    link: p.basketId ? '/owner/basket' : '/owner/rounds',
    message,
  });
}

/**
 * A pending payment past its deadline is voided and nothing moves: a result that arrived late, or
 * a checkout nobody finished (see `voidOverduePayments`).
 */
export async function voidPayment(
  ctx: TxContext,
  paymentId: string,
  reason = 'The payment result arrived after the deadline.',
): Promise<void> {
  const p = await lockPayment(ctx, paymentId);
  if (p.status !== 'pending') return;
  await ctx.tx.payment.update({ where: { id: p.id }, data: { status: 'voided' } });
  await appendLog(ctx, {
    action: 'payment.voided',
    subjectType: 'payment',
    subjectId: p.id,
    scope: { shopId: p.shopId },
    before: { status: 'pending' },
    after: { status: 'voided', deadlineAt: p.deadlineAt.toISOString() },
    reason,
  });
  await reconcilePaymentFees(ctx, p.id);
}
