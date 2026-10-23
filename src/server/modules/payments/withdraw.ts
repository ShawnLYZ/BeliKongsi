import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { availableBalance } from '@/server/modules/payments/available';
import { lockShop } from '@/server/modules/payments/fee';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { forbidden, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';

export type WithdrawalResult = {
  withdrawalId: string;
  amountSen: number;
  partnerReference: string;
  balanceSen: number;
};

/**
 * Owner only. Sends `amountSen` (a whole number from 1 up to the available balance: the balance
 * less what pending payments plan to use) from the shop's balance to its bank account through the
 * payments partner (simulated). One transaction: the posting `shop_balance -> partner_cash`, the
 * withdrawal row, the log entry, the notice (with the partner reference) and the event. A refused
 * amount changes nothing.
 */
export async function withdrawBalance(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  input: { amountSen: number },
): Promise<WithdrawalResult> {
  if (!UUID.test(shopId)) throw notFound('Shop');
  requireShopAccess(caller, shopId, ['owner']);
  if (caller.kind !== 'person') throw forbidden();
  const { amountSen } = input;
  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    // Serialise with other money moves of this shop so the balance read below is not stale.
    await lockShop(ctx, shopId);
    // Balance that a pending payment already plans to use is not free to withdraw.
    const { balanceSen: before, availableSen } = await availableBalance(tx, shopId, now);
    if (!Number.isInteger(amountSen) || amountSen < 1 || amountSen > availableSen) {
      throw unprocessable(
        'INVALID_AMOUNT',
        'Enter a whole number of sen from 1 up to your available balance.',
        { balanceSen: before, availableSen },
      );
    }
    const { reference } = await deps.payments.withdraw({ shopId, amountSen });
    await post(ctx, {
      from: { kind: 'shop_balance', shopId },
      to: { kind: 'partner_cash' },
      amountSen,
      kind: 'withdrawal',
      refs: { shopId },
      memo: reference,
    });
    const row = await tx.withdrawal.create({
      data: { shopId, amountSen, partnerReference: reference, createdAt: now },
    });
    const balanceSen = before - amountSen;
    await appendLog(ctx, {
      action: 'balance.withdrawn',
      subjectType: 'shop',
      subjectId: shopId,
      scope: { shopId },
      before: { balanceSen: before },
      after: { balanceSen, amountSen, partnerReference: reference },
    });
    await notify(ctx, {
      type: 'balance.withdrawn',
      audience: { shopId, roles: ['owner'] },
      link: '/owner/money',
      message: TEMPLATES['balance.withdrawn']({ amountSen, reference }),
      dedupeKey: `balance.withdrawn:${row.id}`,
    });
    await emitEvent(ctx, 'balance.withdrawn', { shopId, amountSen });
    return { withdrawalId: row.id, amountSen, partnerReference: reference, balanceSen };
  });
}
