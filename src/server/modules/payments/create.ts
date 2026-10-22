import type { ParticipationSource, Payment } from '@/generated/prisma/client';
import type { PaymentSummary } from '@/lib/views/payments';
import { appendLog } from '@/server/modules/activity/log';
import { deliveryFeeDue } from '@/server/modules/baskets/amounts';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { activeTotals, priceForShop, type DestinationInput } from '@/server/modules/rounds/quote';
import { deliveryDateOf } from '@/server/modules/rounds/schedule';
import { conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import type { TxContext } from '@/server/platform/tx';
import { settlePayment } from './complete';
import { lockRounds } from './fee';

export type { PaymentSummary } from '@/lib/views/payments';

export type PaymentLineInput = {
  productId: string;
  roundId: string;
  basketLineId?: string;
  quantity: number;
  priceLimitSen: number | null;
  destination: DestinationInput;
};

export type CreatePaymentInput = {
  shopId: string;
  purpose: 'basket' | 'join';
  basketId?: string;
  lines: PaymentLineInput[];
  deadlineAt: Date;
  source: ParticipationSource;
  /** Completes at once without a checkout (the seed, and M11 AutoDebit). */
  settleImmediatelyWith?: 'duitnow_qr' | 'fpx';
};

export const checkoutUrlOf = (p: Pick<Payment, 'id' | 'status' | 'externalSen'>): string | null =>
  p.status === 'pending' && p.externalSen > 0 ? `/checkout/${p.id}` : null;

export function summaryOf(p: Payment): PaymentSummary {
  if (p.status !== 'pending' && p.status !== 'succeeded') {
    throw new Error(`A ${p.status} payment has no summary.`);
  }
  return {
    paymentId: p.id,
    status: p.status,
    linesTotalSen: p.linesTotalSen,
    deliveryFeeSen: p.deliveryFeeSen,
    totalSen: p.totalSen,
    balanceAppliedSen: p.balanceAppliedSen,
    externalSen: p.externalSen,
    checkoutUrl: checkoutUrlOf(p),
  };
}

/**
 * Prices every line at its starting amounts and records a pending payment. The total is the lines
 * plus one delivery fee per door delivery date that is still due (PRD 6.9); the shop balance is
 * used first. A payment the balance covers, or one settled immediately, completes at once;
 * otherwise the simulated partner opens a checkout. The only code that starts money coming in.
 */
export async function createPayment(
  ctx: TxContext,
  input: CreatePaymentInput,
): Promise<PaymentSummary> {
  const { tx, deps } = ctx;
  if (!UUID.test(input.shopId)) throw notFound('Shop');
  // The rounds before the shop (see lockRounds): settling at once below must not wait for a round
  // while it holds the shop that a close of that round needs.
  await lockRounds(
    ctx,
    input.lines.map((l) => l.roundId),
  );
  // One payment is created at a time per shop, so two cannot plan to use the same balance.
  const lockedShop = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM shops WHERE id = ${input.shopId}::uuid FOR UPDATE`;
  if (lockedShop.length === 0) throw notFound('Shop');
  const shop = await tx.shop.findUnique({
    where: { id: input.shopId },
    include: { defaultPickupPoint: true, usualList: { include: { items: true } } },
  });
  if (!shop) throw notFound('Shop');
  const points = await tx.pickupPoint.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
  const usualPrice = new Map(
    (shop.usualList?.items ?? []).map((i) => [i.productId, i.usualPriceSen]),
  );

  const lines = [];
  let doorFeeSen: number | null = null;
  for (const line of input.lines) {
    const round = await tx.round.findUnique({
      where: { id: line.roundId },
      include: { hub: true, product: true },
    });
    if (!round || round.productId !== line.productId) throw notFound('Round');
    if (round.status !== 'open' || round.cutoffAt.getTime() <= ctx.now.getTime()) {
      throw conflict('ROUND_CLOSED', 'This round has closed.');
    }
    const { totalQuantity } = await activeTotals(tx, round.id);
    const q = await priceForShop(deps, round, shop, {
      destination: line.destination,
      quantity: line.quantity,
      total: totalQuantity,
      priceLimitSen: line.priceLimitSen,
      unitName: round.product.unitName,
      points,
    });
    const door = q.destination.type === 'door';
    if (door) doorFeeSen = q.deliveryFeeSen;
    const usual = usualPrice.get(line.productId) ?? null;
    lines.push({
      productId: line.productId,
      roundId: round.id,
      basketLineId: line.basketLineId ?? null,
      quantity: line.quantity,
      priceLimitSen: line.priceLimitSen,
      fulfilment: door ? ('door' as const) : ('pickup' as const),
      destinationType: door ? ('door' as const) : ('pickup_point' as const),
      pickupPointId: q.destination.type === 'pickup_point' ? q.destination.pickupPointId : null,
      deliveryDate: deliveryDateOf(round.cutoffAt),
      unitGoodsSen: q.starting.goodsSen,
      unitFeeSen: q.starting.feeSen,
      unitShippingSen: q.starting.shippingSen,
      unitAllInSen: q.starting.allInSen,
      lineSen: q.startingLineSen,
      baselineSen: usual ?? round.buyAlonePriceSen,
      baselineKind: usual !== null ? ('usual' as const) : ('buy_alone' as const),
    });
  }

  // One fee per door delivery date that has no held charge (see deliveryFeeDue).
  const deliveryFeeDates: string[] = [];
  const doorDates = [
    ...new Set(lines.filter((l) => l.fulfilment === 'door').map((l) => l.deliveryDate)),
  ];
  for (const date of doorDates.sort()) {
    if (await deliveryFeeDue(tx, shop.id, date)) deliveryFeeDates.push(date);
  }
  const deliveryFeeSen = deliveryFeeDates.length * (doorFeeSen ?? 0);

  const linesTotalSen = lines.reduce((sum, l) => sum + l.lineSen, 0);
  const totalSen = linesTotalSen + deliveryFeeSen;
  // The balance other pending payments already plan to use is reserved for them. A pending
  // payment past its deadline can no longer succeed (its result is voided), so it reserves nothing.
  const balance = await balanceOf(tx, { kind: 'shop_balance', shopId: shop.id });
  const reserved = await tx.payment.aggregate({
    where: { shopId: shop.id, status: 'pending', deadlineAt: { gt: ctx.now } },
    _sum: { balanceAppliedSen: true },
  });
  const availableSen = balance - (reserved._sum.balanceAppliedSen ?? 0);
  const balanceAppliedSen = Math.max(0, Math.min(availableSen, totalSen));
  const externalSen = totalSen - balanceAppliedSen;

  const payment = await tx.payment.create({
    data: {
      shopId: shop.id,
      purpose: input.purpose,
      basketId: input.basketId ?? null,
      linesTotalSen,
      deliveryFeeSen,
      deliveryFeeDates,
      totalSen,
      balanceAppliedSen,
      externalSen,
      status: 'pending',
      deadlineAt: input.deadlineAt,
      createdByUserId: ctx.actor.type === 'person' ? ctx.actor.userId : null,
      createdAt: ctx.now,
      lines: { create: lines },
    },
  });
  await appendLog(ctx, {
    action: 'payment.created',
    subjectType: 'payment',
    subjectId: payment.id,
    scope: { shopId: shop.id },
    after: {
      purpose: input.purpose,
      basketId: input.basketId ?? null,
      lineCount: lines.length,
      linesTotalSen,
      deliveryFeeSen,
      totalSen,
      balanceAppliedSen,
      externalSen,
    },
  });

  if (externalSen === 0) {
    await settlePayment(ctx, payment.id, 'balance_only', input.source);
  } else {
    const { reference } = await deps.payments.startCheckout({
      paymentId: payment.id,
      amountSen: externalSen,
    });
    await tx.payment.update({ where: { id: payment.id }, data: { partnerReference: reference } });
    if (input.settleImmediatelyWith) {
      await settlePayment(ctx, payment.id, input.settleImmediatelyWith, input.source);
    }
  }
  return summaryOf(await tx.payment.findUniqueOrThrow({ where: { id: payment.id } }));
}
