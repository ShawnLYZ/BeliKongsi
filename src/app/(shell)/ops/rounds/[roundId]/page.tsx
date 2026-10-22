import { notFound } from 'next/navigation';
import type { OpsRoundDetail } from '@/lib/views/ops';
import { OpsRoundDetailView } from '@/components/ops/round-detail';
import { opsRoundDetail } from '@/server/modules/ops/rounds-board';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { AppError } from '@/server/platform/errors';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OpsRoundPage({ params }: { params: Promise<{ roundId: string }> }) {
  const session = requirePageRole(await getPageSession(), ['ops']);
  const deps = getDeps();
  scheduleDueWork(deps);
  const { roundId } = await params;
  let detail: OpsRoundDetail;
  try {
    detail = await opsRoundDetail(deps, personCaller(session), roundId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return <OpsRoundDetailView detail={detail} />;
}
