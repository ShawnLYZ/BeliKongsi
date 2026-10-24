import { EmptyState } from '@/components/common/empty-state';
import { PickupList } from '@/components/pickups/pickup-list';
import { listShopPickups } from '@/server/modules/fulfilment/pickups';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireStaffShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// Staff see no money anywhere: pickups carry places, dates, codes and goods only (R6).
export default async function StaffDeliveriesPage() {
  const { session, shopId } = requireStaffShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { items } = await listShopPickups(deps, personCaller(session), shopId, {
    status: 'upcoming',
  });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75rem] leading-tight font-bold">Confirm delivery</h1>
      {items.length === 0 ? (
        <EmptyState
          title="Nothing to collect yet"
          explanation="When your goods are ready, each pickup or delivery appears here. Show the code, collect, then check each line."
          example="Ready at Ipoh pickup point (10 am–7 pm). Pickup code 482 913."
        />
      ) : (
        <PickupList items={items} hrefBase="/staff/deliveries" label="Pickups and deliveries" />
      )}
    </div>
  );
}
