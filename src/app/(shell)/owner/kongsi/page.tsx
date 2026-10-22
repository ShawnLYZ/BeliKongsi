import Link from 'next/link';
import { BUTTON_PRIMARY } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { MyKongsiList } from '@/components/rounds/my-kongsi-list';
import { listMyKongsiLines } from '@/server/modules/rounds/read';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerKongsiPage() {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const lines = await listMyKongsiLines(deps, personCaller(session), shopId);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">My Kongsi</h1>
        <p className="text-base">
          Your orders in rounds that are still open. You can cancel a line before its cut-off for a
          full refund to your balance.
        </p>
      </div>
      {lines.length === 0 ? (
        <EmptyState
          title="No Kongsi orders yet"
          explanation="When you pay your weekly basket or join a round, each order shows here with its status."
          example="6 cartons of condensed milk, paid RM 984.54. Waiting for cut-off."
        >
          <Link href="/owner/rounds" className={`${BUTTON_PRIMARY} mt-4 w-full`}>
            See open rounds
          </Link>
        </EmptyState>
      ) : (
        <MyKongsiList lines={lines} />
      )}
    </div>
  );
}
