import Link from 'next/link';
import { LINK } from '@/components/ops/labels';
import { MoneyOverviewView } from '@/components/ops/money-overview';
import { moneyOverview } from '@/server/modules/ops/money';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OpsMoneyPage() {
  const session = requirePageRole(await getPageSession(), ['ops']);
  const deps = getDeps();
  scheduleDueWork(deps);
  const overview = await moneyOverview(deps, personCaller(session));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold">Money overview</h1>
        <p className="mt-1 text-base">
          Where every sen sits now, and the checks that prove it balances. To check the activity log
          has not been changed, use{' '}
          <Link href="/activity" className={LINK}>
            Verify log
          </Link>
          .
        </p>
      </div>
      <MoneyOverviewView overview={overview} />
    </div>
  );
}
