import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClaimStatus } from '@/components/checks/claim-status';
import { TimelineSheet } from '@/components/common/timeline-sheet';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import type { ClaimView } from '@/server/modules/checks/claims';
import { getClaimForCaller } from '@/server/modules/checks/claims';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { AppError } from '@/server/platform/errors';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** The owner's claim: its status and the refund amount. */
export default async function OwnerClaimPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { session } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { claimId } = await params;
  let claim: ClaimView;
  try {
    claim = await getClaimForCaller(deps, personCaller(session), claimId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Your claim</h1>
      <ClaimStatus claim={claim} />
      <TimelineSheet subjectType="claim" subjectId={claimId} title="Claim timeline" />
      <Link href="/owner/pickups" className={BUTTON_SECONDARY}>
        All pickups
      </Link>
    </div>
  );
}
