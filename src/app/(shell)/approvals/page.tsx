import type { Role } from '@/generated/prisma/client';
import { EmptyState } from '@/components/common/empty-state';
import { ApprovalList } from '@/components/shell/approval-list';
import { listPendingApprovals } from '@/server/modules/approvals/approvals';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// Staff have no approvals (and see no money), so they are sent to their own home.
const EXAMPLES: Record<Exclude<Role, 'staff'>, { explanation: string; example: string }> = {
  owner: {
    explanation: 'Your weekly basket waits here for you to approve and pay each week.',
    example: 'Weekly basket: 5 items, RM 1,630.20. Approve by Thu 8 pm.',
  },
  supplier: {
    explanation: 'Orders for your business wait here for you to confirm or reject.',
    example: 'Supplier confirmation: 105 cartons of condensed milk, RM 15,330.00.',
  },
  ops: {
    explanation: 'Supplier orders and claims wait here for your decision.',
    example: 'Supplier order awaiting approval: condensed milk, RM 15,330.00.',
  },
};

export default async function ApprovalsPage() {
  const session = requirePageRole(await getPageSession(), ['owner', 'supplier', 'ops']);
  const role = session.membership.role as Exclude<Role, 'staff'>;
  const items = await listPendingApprovals(getDeps(), personCaller(session));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Approvals</h1>
      {items.length === 0 ? (
        <EmptyState title="Nothing waiting for you" {...EXAMPLES[role]} />
      ) : (
        <ApprovalList
          key={items.map((i) => i.id).join()}
          initialItems={items}
          canDecide={role === 'supplier' || role === 'ops'}
        />
      )}
    </div>
  );
}
