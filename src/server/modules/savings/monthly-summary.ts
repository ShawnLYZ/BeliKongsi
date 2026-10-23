import { mytInstant, mytParts } from '@/lib/time';
import { resolveClock } from '@/server/adapters/clock';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { monthlySavings } from '@/server/modules/savings/savings';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction } from '@/server/platform/tx';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Sends each owner last month's summary (P1-3): rounds, units, refunds, fees and verified
 * savings, once per shop per month. It starts at 09:00 Malaysia time on the 1st and any later run
 * in the month still sends it, so a missed run catches up. Background shops, and shops with no
 * participation in the month, get nothing. The dedupe key makes any number of runs safe.
 */
export async function sendMonthlySummaries(deps: AppDeps): Promise<{ sent: number }> {
  const now = (await resolveClock(deps)).now();
  const { year, month } = mytParts(now);
  if (now.getTime() < mytInstant(year, month, 1, 9, 0).getTime()) return { sent: 0 };

  const summarised = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const key = `${summarised.year}-${String(summarised.month).padStart(2, '0')}`;
  const monthName = MONTH_NAMES[summarised.month - 1]!;

  const shops = await deps.prisma.shop.findMany({
    where: { isBackground: false },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const caller = systemCaller('monthly summaries');
  let sent = 0;
  for (const { id: shopId } of shops) {
    try {
      const view = await monthlySavings(deps, caller, shopId, key);
      if (view.roundsJoined === 0 && view.items.length === 0) continue;
      sent += await withTransaction(deps, caller, (ctx) =>
        notify(ctx, {
          type: 'savings.monthly_summary',
          audience: { shopId, roles: ['owner'] },
          link: '/owner/savings',
          message: TEMPLATES['savings.monthly_summary']({
            monthName,
            roundsJoined: view.roundsJoined,
            unitsBought: view.unitsBought,
            refundsSen: view.refundsSen,
            feesSen: view.feesPaidSen,
            verifiedSen: view.verifiedSavingsSen,
          }),
          dedupeKey: `monthly-summary:${shopId}:${key}`,
        }),
      );
    } catch (error) {
      console.error(
        `Monthly summary failed for ${shopId}:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { sent };
}
