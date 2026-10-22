import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { CollectPanel } from '@/components/pickups/collect-panel';
import { PickupFacts } from '@/components/pickups/pickup-facts';
import { listShopPickups } from '@/server/modules/fulfilment/pickups';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireStaffShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// Staff see no money anywhere (R6).
export default async function StaffDeliveryPage({
  params,
}: {
  params: Promise<{ pickupId: string }>;
}) {
  const { session, shopId } = requireStaffShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { pickupId } = await params;
  // No single-pickup endpoint: the shop's own list is the permission check.
  const { items } = await listShopPickups(deps, personCaller(session), shopId, {});
  const pickup = items.find((p) => p.pickupId === pickupId);
  if (!pickup) notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Confirm delivery</h1>
      <PickupFacts pickup={pickup} />
      <CollectPanel pickup={pickup} />
      <Link href="/staff/deliveries" className={BUTTON_SECONDARY}>
        All pickups
      </Link>
    </div>
  );
}
