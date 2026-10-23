import Link from 'next/link';
import type { ClaimView } from '@/server/modules/checks/claims';
import { Money } from '@/components/common/money';
import { formatMyt } from '@/lib/format';
import { cn } from '@/lib/utils';

const HEADLINE = {
  submitted: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Not approved',
} as const;

/** The owner's view of a claim: status, amount and what was reported (staff have no claim page). */
export function ClaimStatus({ claim }: { claim: ClaimView }) {
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="claim-status"
        className={cn(
          'flex flex-col gap-2 rounded-2xl border-2 p-5',
          claim.status === 'rejected'
            ? 'border-destructive bg-destructive/10'
            : 'border-primary bg-primary/10',
        )}
      >
        <h2 id="claim-status" className="text-xl font-bold">
          {HEADLINE[claim.status]}
        </h2>
        <p className="text-3xl font-bold">
          <Money sen={claim.totalRefundSen} />
        </p>
        <p className="text-base">
          {claim.status === 'submitted' ? (
            'This is the refund you asked for. We will tell you when it has been reviewed.'
          ) : claim.status === 'approved' ? (
            <>
              This was refunded to your BeliKongsi balance.{' '}
              <Link href="/owner/money" className="font-semibold underline underline-offset-4">
                See your money history
              </Link>
              .
            </>
          ) : (
            'No refund was made.'
          )}
        </p>
        {claim.status === 'rejected' && claim.reason ? (
          <p className="text-base">
            <span className="font-semibold">Reason:</span> {claim.reason}
          </p>
        ) : null}
      </section>
      <section
        aria-labelledby="claim-lines"
        className="bg-card flex flex-col gap-2 rounded-2xl border p-5"
      >
        <h2 id="claim-lines" className="text-lg font-semibold">
          What you reported
        </h2>
        <p className="text-muted-foreground text-base">
          Sent{' '}
          <time dateTime={claim.check.submittedAt}>
            {formatMyt(new Date(claim.check.submittedAt))}
          </time>
        </p>
        <ul className="flex flex-col divide-y">
          {claim.lines.map((l, i) => (
            <li key={i} className="flex flex-col gap-2 py-2 text-base">
              <div className="flex justify-between gap-3">
                <span>{l.productName}</span>
                <Money sen={l.refundSen} className="font-semibold" />
              </div>
              <span className="text-muted-foreground tabular-nums">
                {l.missing} missing, {l.damaged} damaged
              </span>
              {l.photoUrls.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {l.photoUrls.map((url, j) => (
                    <li key={j}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Photo ${j + 1} of ${l.productName}`}
                        className="size-24 rounded-xl border object-cover"
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
