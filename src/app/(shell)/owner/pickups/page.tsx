import { EmptyState } from '@/components/common/empty-state';
import { PickupList } from '@/components/pickups/pickup-list';
import { listShopPickups } from '@/server/modules/fulfilment/pickups';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerPickupsPage() {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const caller = personCaller(session);
  const [upcoming, past] = await Promise.all([
    listShopPickups(deps, caller, shopId, { status: 'upcoming' }),
    listShopPickups(deps, caller, shopId, { status: 'past' }),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75rem] leading-tight font-bold">Pickups</h1>
      {upcoming.items.length === 0 ? (
        <EmptyState
          title="Nothing on its way"
          explanation="Once you have paid for a Kongsi, where and when to collect your goods appears here, with your pickup code."
          example="Ipoh pickup point, Tue 11 Nov, code 482 913."
        />
      ) : (
        <PickupList
          items={upcoming.items}
          hrefBase="/owner/pickups"
          groupHrefBase="/owner/pickups/later"
          label="Coming up"
        />
      )}
      {past.items.length > 0 ? (
        <>
          <h2 className="mt-2 text-xl font-bold">Collected and delivered</h2>
          <PickupList
            items={past.items}
            hrefBase="/owner/pickups"
            label="Collected and delivered"
          />
        </>
      ) : null}
    </div>
  );
}
