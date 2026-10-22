import { draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { expireBaskets, sendBasketReminders } from '@/server/modules/baskets/lifecycle';
import { voidOverduePayments } from '@/server/modules/payments/overdue';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { openDueRounds } from '@/server/modules/rounds/open';
import type { AppDeps } from '@/server/platform/deps';

export type JobsReport = {
  openedRounds: number;
  draftedBaskets: number;
  reminders: number;
  voidedPayments: number;
  closedRounds: number;
  /** Due rounds whose close failed: they stay open, with their money held, until a run closes them. */
  failedRounds: number;
  expiredBaskets: number;
};

/**
 * Everything that is due now, in order. Safe to run any number of times. Overdue payments are
 * voided before rounds close, and rounds close (opening their next round) before baskets expire.
 */
export async function runDueJobs(deps: AppDeps): Promise<JobsReport> {
  const { opened } = await openDueRounds(deps);
  const { drafted } = await draftWeeklyBaskets(deps);
  const { sent } = await sendBasketReminders(deps);
  const { voided } = await voidOverduePayments(deps);
  const { closed, failed: failedRounds } = await closeDueRounds(deps);
  const { expired } = await expireBaskets(deps);
  return {
    openedRounds: opened,
    draftedBaskets: drafted,
    reminders: sent,
    voidedPayments: voided,
    closedRounds: closed,
    failedRounds,
    expiredBaskets: expired,
  };
}
