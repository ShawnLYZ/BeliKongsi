import { EmptyState } from '@/components/common/empty-state';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OpsHomePage() {
  requirePageRole(await getPageSession(), ['ops']);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Operations</h1>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <EmptyState
          title="Rounds board"
          explanation="Every open Kongsi round appears here as a table: progress, shops, current tier and cut-off."
          example="Condensed milk: 105 cartons from 9 shops, tier 3, closes Thu 8 pm."
        />
        <EmptyState
          title="Supplier orders and claims"
          explanation="Orders and claims waiting for your decision appear in the approvals inbox."
          example="Supplier order awaiting approval: condensed milk, RM 15,330.00."
        />
        <EmptyState
          title="Consignments"
          explanation="Deliveries from hubs to pickup points and shops appear here with their status buttons (Simulated logistics partner)."
          example="Klang Valley hub to Ipoh pickup point: out for delivery."
        />
      </div>
    </div>
  );
}
