import type { PickupStatus } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { settlePickup } from '@/server/modules/checks/delivery-check';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { refundDeliveryFeeIfUnused } from '@/server/modules/payments/delivery-fees';
import { lockRounds, lockShop } from '@/server/modules/payments/fee';
import { refreshRoundCompletion, roundsOfPickup } from '@/server/modules/rounds/completion';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { completeConsignmentsOf } from './handover';
import { pickupNotLate, uniqueOf } from './late';
import { destinationKeyOf, freePickupsOf, lockDestinations } from './plan';
import { linesStillComing, LIVE_ALLOCATION } from './readiness';

/** How long past the original expected ready time an owner waits before cancelling (P1-7). */
const WAIT_MS = 72 * 60 * 60 * 1000;

/** Pickup statuses at which goods can still be cancelled: nothing has been handed over yet. */
const NOT_HANDED_OVER: PickupStatus[] = ['waiting', 'ready', 'partly_ready', 'out_for_delivery'];

const notCancellable = (message: string) => conflict('NOT_CANCELLABLE', message);

/**
 * An owner cancels a late item for a full refund (P1-7, story 74). Allowed 72 hours after the
 * original expected ready time (409 `TOO_EARLY` before; exactly 72 hours is allowed), and only for
 * a line in a late group (a `LateDelivery` exists, or its expected time has passed and its pickup
 * is not ready, out for delivery or handed over) that is `kept`, or `allocated` and not yet
 * collected or delivered. Anything else is 409 `NOT_CANCELLABLE`.
 *
 * Before the hub check the refund is the line's final price x quantity from the round hold and the
 * supplier order accepts that many fewer units. After it, the refund is allocated units x final
 * price from claims expense (recoverable from the logistics partner), the allocation is marked
 * cancelled and a pickup with no live allocations left closes. The delivery fee goes back too when
 * nothing needs it. Locks: the round, the line, the shop, then the destination.
 */
export async function cancelLateItem(
  deps: AppDeps,
  caller: Caller,
  participationId: string,
): Promise<{
  refundSen: number;
  deliveryFeeRefundSen: number;
  source: 'round_hold' | 'claims_expense';
}> {
  if (!UUID.test(participationId)) throw notFound('Participation');
  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    const owner = await tx.participation.findUnique({
      where: { id: participationId },
      select: { shopId: true, roundId: true },
    });
    if (!owner) throw notFound('Participation');
    await lockRounds(ctx, [owner.roundId]);
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM participations WHERE id = ${participationId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Participation');
    await lockShop(ctx, owner.shopId);
    const part = await tx.participation.findUniqueOrThrow({
      where: { id: participationId },
      include: { round: { include: { product: true } } },
    });
    // Another shop's participation is a 404; this shop's staff and Ops get 403.
    requireShopAccess(caller, part.shopId, ['owner']);
    const group = {
      shopId: part.shopId,
      destinationKey: destinationKeyOf(part),
      deliveryDate: part.deliveryDate,
    };
    await lockDestinations(ctx, [group.destinationKey]);

    const afterHub = part.status === 'allocated';
    if (part.status !== 'kept' && !afterHub) {
      throw notCancellable('This item can no longer be cancelled.');
    }
    const pickup = await tx.pickup.findUnique({
      where: uniqueOf(group),
      select: {
        id: true,
        status: true,
        shopId: true,
        deliveryDate: true,
        destinationType: true,
        pickupPointId: true,
      },
    });
    const allocation = afterHub
      ? await tx.allocation.findUnique({ where: { participationId: part.id } })
      : null;
    if (
      afterHub &&
      (!allocation ||
        allocation.cancelledLateAt ||
        allocation.collectionId ||
        (pickup && !NOT_HANDED_OVER.includes(pickup.status)))
    ) {
      throw notCancellable('These goods have already been handed over.');
    }

    // Late (R2): a recorded late group, or past its expected time and not ready, out or handed over.
    const lateRow = await tx.lateDelivery.findUnique({ where: uniqueOf(group) });
    const pastExpected = part.round.expectedReadyAt.getTime() <= now.getTime();
    if (!lateRow && !(pastExpected && !(pickup && (await pickupNotLate(tx, pickup))))) {
      throw notCancellable('These goods are not late.');
    }
    const original = lateRow?.originalExpectedAt ?? part.round.expectedReadyAt;
    if (now.getTime() < original.getTime() + WAIT_MS) {
      throw conflict('TOO_EARLY', 'You can cancel a late item 3 days after it was due.');
    }

    const finalSen = part.finalAllInSen ?? 0;
    const units = allocation ? allocation.allocated : part.quantity;
    const refundSen = finalSen * units;
    const source = afterHub ? 'claims_expense' : 'round_hold';

    await tx.participation.update({
      where: { id: part.id },
      data: {
        status: 'cancelled_late',
        outcomeReason: 'Cancelled late by the owner.',
        updatedAt: now,
      },
    });
    if (allocation) {
      await tx.allocation.update({ where: { id: allocation.id }, data: { cancelledLateAt: now } });
    } else {
      await tx.supplierOrder.update({
        where: { roundId: part.roundId },
        data: { acceptedQuantity: { decrement: part.quantity } },
      });
    }
    await post(ctx, {
      from: afterHub ? { kind: 'claims_expense' } : { kind: 'round_hold', roundId: part.roundId },
      to: { kind: 'shop_balance', shopId: part.shopId },
      amountSen: refundSen,
      kind: 'refund_late',
      refs: {
        roundId: part.roundId,
        participationId: part.id,
        paymentId: part.paymentId,
        shopId: part.shopId,
      },
      memo: 'A late item was cancelled for a full refund.',
    });

    const deliveryFeeRefundSen =
      part.destinationType === 'door'
        ? await refundDeliveryFeeIfUnused(ctx, part.shopId, part.deliveryDate)
        : 0;

    let pickupClosed = false;
    if (afterHub && pickup) {
      const live = await tx.allocation.count({
        where: { pickupId: pickup.id, allocated: { gt: 0 }, ...LIVE_ALLOCATION },
      });
      // Lines of another round still on their way to this place and date will join this pickup.
      const comingLater = await linesStillComing(tx, part);
      if (live === 0 && comingLater === 0) {
        await tx.pickup.update({ where: { id: pickup.id }, data: { status: 'closed' } });
        pickupClosed = true;
        await refreshRoundCompletion(ctx, await roundsOfPickup(ctx, pickup.id));
      } else if (comingLater === 0) {
        // Part was collected already (P1-8): with nothing left to come, that part is all of it.
        pickupClosed = (await settlePickup(ctx, pickup.id)) === 'closed';
      }
    }
    // Fewer goods to wait for (or a line no longer held back): the pickup may now be ready.
    if (!pickupClosed) await freePickupsOf(ctx, [part]);
    // An arrived consignment with nothing left to collect on it is done.
    if (afterHub && pickup) await completeConsignmentsOf(ctx, pickup.id);

    const scope = { shopId: part.shopId };
    await appendLog(ctx, {
      action: 'participation.cancelled_late',
      subjectType: 'participation',
      subjectId: part.id,
      scope,
      before: { status: part.status },
      after: { status: 'cancelled_late', roundId: part.roundId, units, source, pickupClosed },
    });
    await appendLog(ctx, {
      action: 'refund.issued',
      subjectType: 'participation',
      subjectId: part.id,
      scope,
      after: { amountSen: refundSen, kind: 'late', source },
    });
    await emitEvent(ctx, 'refund.issued', {
      shopId: part.shopId,
      amountSen: refundSen,
      kind: 'late',
      referenceId: part.id,
    });
    // Owner only: the notice carries money, so staff never get it.
    await notify(ctx, {
      type: 'delivery.late_cancelled',
      audience: { shopId: part.shopId, roles: ['owner'] },
      link: pickup ? `/owner/pickups/${pickup.id}` : '/owner/pickups',
      message: TEMPLATES['delivery.late_cancelled']({
        quantity: units,
        unitName: part.round.product.unitName,
        shortName: part.round.product.shortName,
        refundSen: refundSen + deliveryFeeRefundSen,
      }),
      dedupeKey: `delivery.late_cancelled:${part.id}`,
    });
    return { refundSen, deliveryFeeRefundSen, source };
  });
}
