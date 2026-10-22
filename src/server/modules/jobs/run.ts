import { draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { expireBaskets, sendBasketReminders } from '@/server/modules/baskets/lifecycle';
import { voidOverduePayments } from '@/server/modules/payments/overdue';
import { openDueRounds } from '@/server/modules/rounds/open';
import type { AppDeps } from '@/server/platform/deps';

export type JobsReport = {
  openedRounds: number;
  draftedBaskets: number;
  reminders: number;
  voidedPayments: number;
  expiredBaskets: number;
};

/**
 * Everything that is due now, in order. Safe to run any number of times. Overdue payments are
 * voided before baskets expire. M5 inserts closeDueRounds before expireBaskets.
 */
export async function runDueJobs(deps: AppDeps): Promise<JobsReport> {
  const { opened } = await openDueRounds(deps);
  const { drafted } = await draftWeeklyBaskets(deps);
  const { sent } = await sendBasketReminders(deps);
  const { voided } = await voidOverduePayments(deps);
  const { expired } = await expireBaskets(deps);
  return {
    openedRounds: opened,
    draftedBaskets: drafted,
    reminders: sent,
    voidedPayments: voided,
    expiredBaskets: expired,
  };
}
