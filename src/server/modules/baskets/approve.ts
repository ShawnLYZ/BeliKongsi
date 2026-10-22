import type { PaymentSummary } from '@/lib/views/payments';
import { createPayment, summaryOf } from '@/server/modules/payments/create';
import type { DestinationInput } from '@/server/modules/rounds/quote';
import { defaultDestination } from '@/server/modules/rounds/quote';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';

export const ROUND_CLOSED_NOTICE = 'Removed: this round closed before you paid.';

const basketEmpty = () =>
  unprocessable('BASKET_EMPTY', 'There is nothing left in this basket to pay for.');

/**
 * The owner approves the basket and pays (PRD 8). Every line is re-quoted; a line whose round has
 * closed is removed with a notice. A basket already waiting for its payment returns that payment,
 * so a second tap never makes a second one; a paid basket returns the payment that paid it.
 */
export async function approveBasket(
  deps: AppDeps,
  caller: Caller,
  basketId: string,
): Promise<PaymentSummary> {
  if (!UUID.test(basketId)) throw notFound('Basket');
  const result = await withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    // The row lock makes a concurrent second tap wait, then see the pending payment.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM weekly_baskets WHERE id = ${basketId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Basket');
    const basket = await tx.weeklyBasket.findUniqueOrThrow({ where: { id: basketId } });
    requireShopAccess(caller, basket.shopId, ['owner']);

    if (basket.status === 'payment_pending' || basket.status === 'paid') {
      const payment = await tx.payment.findFirst({
        where: {
          basketId,
          status: basket.status === 'paid' ? 'succeeded' : 'pending',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (payment) return { summary: summaryOf(payment) };
    }
    if (
      basket.status !== 'draft' ||
      !basket.draftedAt ||
      now.getTime() >= basket.deadlineAt.getTime()
    ) {
      throw conflict('BASKET_CLOSED', 'This basket can no longer be approved.');
    }

    // Re-quote: lines whose round is no longer open are removed with a notice.
    const lines = await tx.basketLine.findMany({
      where: { basketId, removed: false, roundId: { not: null } },
      orderBy: { id: 'asc' },
    });
    const rounds = await tx.round.findMany({
      where: { id: { in: lines.map((l) => l.roundId!) } },
    });
    const roundById = new Map(rounds.map((r) => [r.id, r]));
    const payable = [];
    let deadlineMs = basket.deadlineAt.getTime();
    for (const line of lines) {
      const round = roundById.get(line.roundId!);
      if (round && round.status === 'open' && round.cutoffAt.getTime() > now.getTime()) {
        payable.push(line);
        deadlineMs = Math.min(deadlineMs, round.cutoffAt.getTime());
        continue;
      }
      await tx.basketLine.update({
        where: { id: line.id },
        data: { removed: true, notice: ROUND_CLOSED_NOTICE },
      });
    }
    // Answered after the transaction, so the removal notices stay.
    if (payable.length === 0) return { summary: null };

    const shop = await tx.shop.findUniqueOrThrow({
      where: { id: basket.shopId },
      include: { defaultPickupPoint: true },
    });
    let destination: DestinationInput;
    if (basket.fulfilment === 'door') destination = { type: 'door' };
    else if (basket.pickupPointId) {
      destination = { type: 'pickup_point', pickupPointId: basket.pickupPointId };
    } else {
      const points = await tx.pickupPoint.findMany({
        where: { active: true },
        orderBy: { id: 'asc' },
      });
      destination = defaultDestination({ ...shop, defaultFulfilment: 'pickup' }, points);
    }

    await tx.weeklyBasket.update({ where: { id: basketId }, data: { status: 'payment_pending' } });
    const summary = await createPayment(ctx, {
      shopId: basket.shopId,
      purpose: 'basket',
      basketId,
      lines: payable.map((l) => ({
        productId: l.productId,
        roundId: l.roundId!,
        basketLineId: l.id,
        quantity: l.quantity,
        priceLimitSen: l.priceLimitSen,
        destination,
      })),
      // No result may land after any of its rounds has closed.
      deadlineAt: new Date(deadlineMs),
      source: 'weekly_basket',
    });
    // The approval shows what is being paid now, not what the draft was.
    if (basket.approvalRequestId) {
      await tx.approvalRequest.update({
        where: { id: basket.approvalRequestId },
        data: { amountSen: summary.totalSen },
      });
    }
    return { summary };
  });
  if (!result.summary) throw basketEmpty();
  return result.summary;
}
