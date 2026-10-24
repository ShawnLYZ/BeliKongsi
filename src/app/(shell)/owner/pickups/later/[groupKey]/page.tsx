import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { LateBanner } from '@/components/pickups/late-banner';
import { LateCancelList } from '@/components/pickups/late-cancel-list';
import { PickupDetail } from '@/components/pickups/pickup-detail';
import { shopPickupGroup } from '@/server/modules/fulfilment/pickups';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/**
 * The owner's page for goods not yet planned into a pickup (their rounds are not hub-checked):
 * where they are and, when the supplier is late, "Cancel late item" (P1-7). Owner only.
 */
export default async function OwnerPickupGroupPage({
  params,
}: {
  params: Promise<{ groupKey: string }>;
}) {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { groupKey } = await params;
  const group = await shopPickupGroup(deps, personCaller(session), shopId, groupKey);
  if (!group) notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75rem] leading-tight font-bold">Your goods on the way</h1>
      <LateBanner pickup={group} showCancelNote />
      <PickupDetail pickup={group} />
      <LateCancelList pickup={group} />
      <Link href="/owner/pickups" className={BUTTON_SECONDARY}>
        All pickups
      </Link>
    </div>
  );
}
