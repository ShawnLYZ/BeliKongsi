import type { Role } from '@/generated/prisma/client';
import { EmptyState } from '@/components/common/empty-state';
import { NotificationList } from '@/components/shell/notification-list';
import { listNotifications } from '@/server/modules/notifications/query';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// Examples from PRD §13. The staff one carries no amount.
const EXAMPLES: Record<Role, string> = {
  owner:
    'Your Kongsi basket for this week is ready: 5 items, RM 1,630.20 now, about RM 1,512 after cut-off. Approve by Thu 8 pm.',
  staff: 'Ready at Ipoh pickup point (10 am–7 pm). Pickup code 482 913.',
  supplier:
    'New BeliKongsi order: 105 cartons of condensed milk for the Klang Valley hub. Please confirm.',
  ops: 'Supplier order awaiting approval: condensed milk, RM 15,330.00.',
};

export default async function NotificationsPage() {
  const session = requirePageRole(await getPageSession(), ['owner', 'staff', 'supplier', 'ops']);
  const page = await listNotifications(getDeps(), personCaller(session), {
    cursor: null,
    limit: 20,
  });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Notifications</h1>
      {page.items.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          explanation="Messages about your Kongsi orders appear here, each with WhatsApp preview text and a Share via WhatsApp button."
          example={EXAMPLES[session.membership.role]}
        />
      ) : (
        <NotificationList
          key={page.items[0]?.id}
          initialItems={page.items}
          initialCursor={page.nextCursor}
        />
      )}
    </div>
  );
}
