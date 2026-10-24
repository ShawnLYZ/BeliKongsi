import type { StaffBasketView } from '@/lib/views/baskets';
import { StaffAdd } from '@/components/baskets/staff-add';
import { EmptyState } from '@/components/common/empty-state';
import { getCurrentBasket } from '@/server/modules/baskets/basket';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// Staff see no money anywhere: the staff basket view has quantities only (R6).
export default async function StaffAddPage() {
  const session = requirePageRole(await getPageSession(), ['staff']);
  const shopId = session.membership.shopId;
  const basket = shopId
    ? ((await getCurrentBasket(getDeps(), personCaller(session), shopId)) as StaffBasketView | null)
    : null;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold">Add to next basket</h1>
        <p className="text-base">Your owner approves everything you add before it is ordered.</p>
      </div>
      {basket ? (
        <StaffAdd basket={basket} />
      ) : (
        <EmptyState
          title="No basket to add to yet"
          explanation="Your shop's weekly basket is made every Monday at 6 am once your owner has finished setup. Then you can add to it here."
          example="1 carton of evaporated milk, waiting for owner's approval."
        />
      )}
    </div>
  );
}
