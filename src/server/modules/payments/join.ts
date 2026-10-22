import type { ParticipationSource } from '@/generated/prisma/client';
import { defaultDestination, type DestinationInput } from '@/server/modules/rounds/quote';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, forbidden, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { failPayment } from './complete';
import { createPayment, type PaymentSummary } from './create';
import { lockShop } from './fee';

export type JoinInput = {
  quantity: number;
  priceLimitSen?: number | null;
  destination?: DestinationInput;
};

export type JoinOptions = {
  /** The shop that joins, for a system caller (the seed). Owners join for their own shop. */
  shopId?: string;
  source?: ParticipationSource;
  settleImmediatelyWith?: 'duitnow_qr' | 'fpx';
};

/**
 * An owner joins an open round from the catalogue (story 46). Everything goes through
 * `createPayment`: the shop is in the round, and money is posted, only when the payment succeeds.
 * The payment is due by the round's cut-off. A new join supersedes the shop's pending join for the
 * same round (an abandoned checkout): that one fails, with no postings, before the new one starts.
 */
export async function joinRound(
  deps: AppDeps,
  caller: Caller,
  roundId: string,
  input: JoinInput,
  opts: JoinOptions = {},
): Promise<PaymentSummary> {
  let shopId: string | undefined;
  if (caller.kind === 'person') {
    shopId = caller.session.membership.shopId;
    if (!shopId) throw forbidden();
    requireShopAccess(caller, shopId, ['owner']);
  } else {
    shopId = opts.shopId;
    if (!shopId) throw unprocessable('SHOP_REQUIRED', 'A system join needs the shop that joins.');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw unprocessable('INVALID_QUANTITY', 'Quantity must be a whole number of at least 1.');
  }
  if (!UUID.test(roundId)) throw notFound('Round');
  const joiningShopId = shopId;

  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    const round = await tx.round.findUnique({ where: { id: roundId } });
    if (!round) throw notFound('Round');
    if (round.status !== 'open' || round.cutoffAt.getTime() <= now.getTime()) {
      throw conflict('ROUND_CLOSED', 'This round has closed.');
    }
    let destination = input.destination;
    if (!destination) {
      const shop = await tx.shop.findUnique({
        where: { id: joiningShopId },
        include: { defaultPickupPoint: true },
      });
      if (!shop) throw notFound('Shop');
      const points = await tx.pickupPoint.findMany({
        where: { active: true },
        orderBy: { id: 'asc' },
      });
      destination = defaultDestination(shop, points);
    }
    // The shop lock first (the payments lock order), so two taps supersede one after another.
    await lockShop(ctx, joiningShopId);
    const earlier = await tx.payment.findMany({
      where: {
        shopId: joiningShopId,
        purpose: 'join',
        status: 'pending',
        lines: { some: { roundId: round.id } },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const p of earlier) await failPayment(ctx, p.id, { superseded: true });
    return createPayment(ctx, {
      shopId: joiningShopId,
      purpose: 'join',
      lines: [
        {
          productId: round.productId,
          roundId: round.id,
          quantity: input.quantity,
          priceLimitSen: input.priceLimitSen ?? null,
          destination,
        },
      ],
      deadlineAt: round.cutoffAt,
      source: opts.source ?? 'catalogue',
      ...(opts.settleImmediatelyWith ? { settleImmediatelyWith: opts.settleImmediatelyWith } : {}),
    });
  });
}
