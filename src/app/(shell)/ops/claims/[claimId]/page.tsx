import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClaimReview } from '@/components/ops/claim-review';
import { LINK } from '@/components/ops/labels';
import type { ClaimView } from '@/server/modules/checks/claims';
import { getClaimForCaller } from '@/server/modules/checks/claims';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { AppError } from '@/server/platform/errors';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** Ops reviews one claim: photos, the shop's check, the hub record and the consignment history. */
export default async function OpsClaimPage({ params }: { params: Promise<{ claimId: string }> }) {
  const session = requirePageRole(await getPageSession(), ['ops']);
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
      <p>
        <Link href="/ops" className={LINK}>
          Back to approvals
        </Link>
      </p>
      <ClaimReview claim={claim} />
    </div>
  );
}
