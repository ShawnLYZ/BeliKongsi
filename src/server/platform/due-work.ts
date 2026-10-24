import { after } from 'next/server';
import { deliverDueWebhooks } from '@/server/modules/integration/webhooks';
import { runDueJobs } from '@/server/modules/jobs/run';
import type { AppDeps } from './deps';

const MIN_GAP_MS = 30_000;
let lastScheduledAt = Number.NEGATIVE_INFINITY;

/**
 * Runs the due jobs after the response, at most once per 30 seconds per server instance. Pages
 * call this; a failure is logged and never reaches the page.
 */
export function scheduleDueWork(deps: AppDeps): void {
  const nowMs = deps.clock.now().getTime();
  if (nowMs - lastScheduledAt < MIN_GAP_MS) return;
  lastScheduledAt = nowMs;
  after(async () => {
    try {
      await runDueJobs(deps);
    } catch (error) {
      console.error('Due work failed:', error instanceof Error ? error.message : 'unknown error');
    }
  });
}

/**
 * Sends due webhook deliveries after the response, so an event a request just committed (such as
 * a demo round close) reaches its receivers without waiting for the next jobs run. A failure is
 * logged and never reaches the caller. Outside a request scope (scripts, tests) `after` is not
 * available and nothing is scheduled; the due jobs deliver instead.
 */
export function scheduleWebhookDelivery(deps: AppDeps): void {
  try {
    after(async () => {
      try {
        await deliverDueWebhooks(deps);
      } catch (error) {
        console.error(
          'Webhook delivery failed:',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
    });
  } catch {
    // No request scope: the next runDueJobs delivers.
  }
}
