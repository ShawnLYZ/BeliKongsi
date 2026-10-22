import { EmptyState } from '@/components/common/empty-state';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function SupplierHomePage() {
  const session = requirePageRole(await getPageSession(), ['supplier']);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{session.membership.orgName}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <EmptyState
          title="Orders to confirm"
          explanation="When a Kongsi round forms and Ops approves it, the order appears here for you to confirm with a dispatch date or reject with a reason."
          example="New BeliKongsi order: 105 cartons of condensed milk for the Klang Valley hub."
        />
        <EmptyState
          title="Payouts"
          explanation="Payments for delivered orders appear here (Simulated)."
          example="Payment released: RM 15,330.00 for 105 cartons (simulated)."
        />
      </div>
    </div>
  );
}
