import { SimulatedBadge } from '@/components/common/simulated-badge';
import { ConsignmentBoard } from '@/components/ops/consignment-board';
import { NetworkView } from '@/components/ops/network-view';
import { listPickupPointsForShop } from '@/server/modules/directory/directory';
import { listConsignments } from '@/server/modules/fulfilment/consignments';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OpsConsignmentsPage() {
  const session = requirePageRole(await getPageSession(), ['ops']);
  const deps = getDeps();
  scheduleDueWork(deps);
  const caller = personCaller(session);
  const [consignments, points] = await Promise.all([
    listConsignments(deps, caller, {}),
    listPickupPointsForShop(deps, caller),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          Consignments <SimulatedBadge />
        </h1>
        <p className="mt-1 text-base">
          Goods on the road from each hub, by status. The logistics partner is simulated: moving a
          consignment here stands in for the partner&rsquo;s update.
        </p>
      </div>
      <ConsignmentBoard consignments={consignments} />
      <NetworkView
        consignments={consignments}
        points={points.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng }))}
      />
    </div>
  );
}
