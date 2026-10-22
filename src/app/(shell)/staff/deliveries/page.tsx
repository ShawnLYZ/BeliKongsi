import { EmptyState } from '@/components/common/empty-state';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// Staff see no money anywhere. Pickups and delivery checks arrive with fulfilment (M7).
export default async function StaffDeliveriesPage() {
  requirePageRole(await getPageSession(), ['staff']);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Confirm delivery</h1>
      <EmptyState
        title="Nothing to collect yet"
        explanation="When your goods are ready, each pickup or delivery appears here. Show the code, collect, then check each line."
        example="Ready at Ipoh pickup point (10 am–7 pm). Pickup code 482 913."
      />
    </div>
  );
}
