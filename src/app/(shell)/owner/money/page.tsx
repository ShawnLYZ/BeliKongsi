import { MoneyHistory } from '@/components/money/money-history';
import { getBalanceView } from '@/server/modules/payments/views';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerMoneyPage() {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const view = await getBalanceView(deps, personCaller(session), shopId, {
    cursor: null,
    limit: 20,
  });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75rem] leading-tight font-bold">Money</h1>
      <MoneyHistory shopId={shopId} initial={view} />
    </div>
  );
}
