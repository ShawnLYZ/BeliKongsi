import { EmptyState } from '@/components/common/empty-state';
import { MonthSwitcher, SavingsMonth } from '@/components/home/savings-month';
import { TimeSavedCard } from '@/components/home/time-saved-card';
import { mytParts } from '@/lib/time';
import { resolveClock } from '@/server/adapters/clock';
import { monthlySavings } from '@/server/modules/savings/savings';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerSavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { month: asked } = await searchParams;
  const { year, month: thisMonth } = mytParts((await resolveClock(deps)).now());
  const current = `${year}-${String(thisMonth).padStart(2, '0')}`;
  // A month that is not YYYY-MM falls back to the current one rather than showing an error.
  const month =
    typeof asked === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : current;
  const view = await monthlySavings(deps, personCaller(session), shopId, month);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Savings</h1>
      <MonthSwitcher month={month} current={current} />
      <SavingsMonth view={view} />
      <TimeSavedCard view={view.timeSaved} />
      {view.items.length === 0 ? (
        <EmptyState
          title="No rounds in this month"
          explanation="After a cut-off, each round you joined shows here. It is Estimated until your goods are checked."
          example="Condensed milk, RM 65.75 saved, Verified."
        />
      ) : null}
    </div>
  );
}
