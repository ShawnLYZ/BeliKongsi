import { draftWeeklyBaskets } from '@/server/modules/baskets/draft';
import { expireBaskets, sendBasketReminders } from '@/server/modules/baskets/lifecycle';
import { deletePhotosPastRetention } from '@/server/modules/checks/photo-retention';
import { sweepDeletedPhotos } from '@/server/modules/directory/deletion';
import { detectLateDeliveries } from '@/server/modules/fulfilment/late';
import { enforceCheckWindow, remindUncollected } from '@/server/modules/fulfilment/reminders';
import { deliverDueWebhooks } from '@/server/modules/integration/webhooks';
import { voidOverduePayments } from '@/server/modules/payments/overdue';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { openDueRounds } from '@/server/modules/rounds/open';
import { sendMonthlySummaries } from '@/server/modules/savings/monthly-summary';
import { sendOperationalReminders } from '@/server/modules/supplier-orders/reminders';
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
  /** Owner notices of last month's savings sent by this run. */
  monthlySummaries: number;
  /** Groups of goods this run found late (each is announced once). */
  lateDeliveries: number;
  /** Pickups whose waiting goods got a day 1, 3 or 7 reminder from this run. */
  uncollectedReminders: number;
  /** Collections reminded at 24 h to check their goods. */
  checkReminders: number;
  /** Collections closed at 72 h as "received, not checked". */
  uncheckedClosed: number;
  /** Notices sent for stalled confirmations, overdue approvals, missed dispatches and hub checks. */
  operationalReminders: number;
  /** Webhook deliveries that reached their receiver in this run. */
  deliveredWebhooks: number;
  /** Delivery photos deleted because they passed their 90 days. */
  deletedPhotos: number;
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
  const { detected: lateDeliveries } = await detectLateDeliveries(deps);
  const { reminded: uncollectedReminders } = await remindUncollected(deps);
  const { reminded: checkReminders, closed: uncheckedClosed } = await enforceCheckWindow(deps);
  const { sent: operationalReminders } = await sendOperationalReminders(deps);
  // The last four steps each run even when an earlier one throws, so a failing step never holds
  // up the others; the first failure is rethrown once they have all run.
  const failures: unknown[] = [];
  async function settle<T>(step: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await step();
    } catch (error) {
      failures.push(error);
      return fallback;
    }
  }
  // Before the sweep below, which retries any file whose removal failed here.
  const { deleted: deletedPhotos } = await settle(() => deletePhotosPastRetention(deps), {
    deleted: 0,
  });
  const { sent: monthlySummaries } = await settle(() => sendMonthlySummaries(deps), { sent: 0 });
  // Removes files of photos deleted with an anonymised shop whose first purge failed.
  await settle(() => sweepDeletedPhotos(deps), null);
  // Last, so the events this run emitted go out in the same run.
  const { succeeded: deliveredWebhooks } = await settle(() => deliverDueWebhooks(deps), {
    attempted: 0,
    succeeded: 0,
    failed: 0,
  });
  if (failures.length > 0) throw failures[0];
  return {
    openedRounds: opened,
    draftedBaskets: drafted,
    reminders: sent,
    voidedPayments: voided,
    closedRounds: closed,
    failedRounds,
    expiredBaskets: expired,
    monthlySummaries,
    lateDeliveries,
    uncollectedReminders,
    checkReminders,
    uncheckedClosed,
    operationalReminders,
    deliveredWebhooks,
    deletedPhotos,
  };
}
