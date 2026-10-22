import { RoundsBoard } from '@/components/ops/rounds-board';
import { opsRoundsBoard } from '@/server/modules/ops/rounds-board';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OpsRoundsPage() {
  const session = requirePageRole(await getPageSession(), ['ops']);
  const deps = getDeps();
  scheduleDueWork(deps);
  const board = await opsRoundsBoard(deps, personCaller(session), {});
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Rounds board</h1>
        <p className="mt-1 text-base">Every Kongsi round by status, newest cut-off first.</p>
      </div>
      <RoundsBoard board={board} />
    </div>
  );
}
