import { OpsInbox } from '@/components/ops/ops-inbox';
import { listPendingApprovals } from '@/server/modules/approvals/approvals';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** The Ops approvals inbox: supplier orders and claims waiting for a decision. */
export default async function OpsHomePage() {
  const session = requirePageRole(await getPageSession(), ['ops']);
  const deps = getDeps();
  scheduleDueWork(deps);
  const items = await listPendingApprovals(deps, personCaller(session));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="mt-1 text-base">
          Nothing consequential happens without you: approve each supplier order against its
          evidence, and review each claim with its photos.
        </p>
      </div>
      <OpsInbox key={items.map((i) => i.id).join()} initialItems={items} />
    </div>
  );
}
