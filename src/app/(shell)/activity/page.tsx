import type { Role } from '@/generated/prisma/client';
import { EmptyState } from '@/components/common/empty-state';
import { ActivityFeed } from '@/components/shell/activity-feed';
import { VerifyLogButton } from '@/components/shell/verify-log-button';
import { queryLog } from '@/server/modules/activity/query';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// What each role sees (PRD §14 visibility); staff see only their own actions.
const INTRO: Record<Role, string> = {
  owner: 'Everything done for your shop, newest first.',
  staff: 'Your own actions, newest first.',
  supplier: 'Everything about your orders, newest first.',
  ops: 'Every entry in the hash-chained activity log, newest first.',
};

export default async function ActivityPage() {
  const session = requirePageRole(await getPageSession(), ['owner', 'staff', 'supplier', 'ops']);
  const { role } = session.membership;
  const page = await queryLog(getDeps(), personCaller(session), { cursor: null, limit: 20 });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{role === 'staff' ? 'My actions' : 'Activity log'}</h1>
        <p className="mt-1 text-base">{INTRO[role]}</p>
      </div>
      {role === 'ops' ? <VerifyLogButton /> : null}
      {page.items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          explanation="Each sign-in, approval, payment and delivery check appears here with who did it and when."
          example="Signed in · Mon 3 Nov, 9:15 am."
        />
      ) : (
        <ActivityFeed
          key={page.items[0]?.seq}
          initialItems={page.items}
          initialCursor={page.nextCursor}
        />
      )}
    </div>
  );
}
