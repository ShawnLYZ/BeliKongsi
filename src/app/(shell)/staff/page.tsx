import { EmptyState } from '@/components/common/empty-state';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// Staff see no money anywhere: nothing on this page shows an amount.
export default async function StaffHomePage() {
  const session = requirePageRole(await getPageSession(), ['staff']);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Hi, {session.displayName}</h1>
      <EmptyState
        title="Add to next basket"
        explanation="A big button to add something your shop needs to next week's basket appears here. Your owner approves it."
        example="1 carton of evaporated milk, waiting for owner's approval."
      />
      <EmptyState
        title="Confirm delivery"
        explanation="When your goods are ready, a big button to collect them and check each line appears here."
        example="Ready at Ipoh pickup point (10 am–7 pm). Pickup code 482 913."
      />
    </div>
  );
}
