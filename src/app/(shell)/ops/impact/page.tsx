import { ImpactPanelView } from '@/components/ops/impact-panel';
import { impactMetrics } from '@/server/modules/ops/impact';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OpsImpactPage() {
  const session = requirePageRole(await getPageSession(), ['ops']);
  const deps = getDeps();
  scheduleDueWork(deps);
  const impact = await impactMetrics(deps, personCaller(session));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold">Impact</h1>
        <p className="mt-1 text-base">
          The numbers the pilot is judged on, worked out from the live data each time you open this
          page. A dash means there is nothing to measure yet.
        </p>
      </div>
      <ImpactPanelView impact={impact} />
    </div>
  );
}
