import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { DeliveryChecks } from '@/components/checks/delivery-check-form';
import { TimelineSheet } from '@/components/common/timeline-sheet';
import { CollectionsList } from '@/components/pickups/collections-list';
import { LateBanner } from '@/components/pickups/late-banner';
import { LateCancelList } from '@/components/pickups/late-cancel-list';
import { PickupDetail } from '@/components/pickups/pickup-detail';
import { listShopPickups } from '@/server/modules/fulfilment/pickups';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerPickupPage({
  params,
}: {
  params: Promise<{ pickupId: string }>;
}) {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { pickupId } = await params;
  // No single-pickup endpoint: the shop's own list is the permission check.
  const { items } = await listShopPickups(deps, personCaller(session), shopId, {});
  const pickup = items.find((p) => p.pickupId === pickupId);
  if (!pickup) notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75rem] leading-tight font-bold">Your pickup</h1>
      <LateBanner pickup={pickup} showCancelNote />
      <PickupDetail pickup={pickup} />
      <LateCancelList pickup={pickup} />
      <CollectionsList pickup={pickup} />
      <DeliveryChecks pickup={pickup} claimBase="/owner/claims" />
      <TimelineSheet subjectType="pickup" subjectId={pickupId} title="Pickup timeline" />
      <Link href="/owner/pickups" className={BUTTON_SECONDARY}>
        All pickups
      </Link>
    </div>
  );
}
