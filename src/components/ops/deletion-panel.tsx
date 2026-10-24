'use client';

import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ApprovalView } from '@/server/modules/approvals/approvals';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_LABEL, INPUT } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { formatMyt } from '@/lib/format';
import { blockersText, deletionEvidenceOf } from './deletion-evidence';
import { cn } from '@/lib/utils';

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t py-2 first:border-t-0">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * A shop's deletion request with the counts that stop it, as the server counted them when the page
 * loaded (not as stored at request time). Approve anonymises the shop (money records and the log
 * are kept); a 422 DELETION_BLOCKED shows what is still open. Reject needs a reason, which the
 * owner sees.
 */
export function DeletionPanel({
  item,
  onDecided,
}: {
  item: ApprovalView;
  onDecided: (id: string) => void;
}) {
  const id = useId();
  const [evidence, setEvidence] = useState(() => deletionEvidenceOf(item.evidence));
  const [blocked, setBlocked] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const stuck = blockersText(evidence);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await apiFetch(`/api/approvals/${item.id}/${decision}`, {
        method: 'POST',
        body: decision === 'reject' ? { reason: reason.trim() } : {},
        quiet: true,
      });
      toast.success(
        decision === 'approve'
          ? 'Approved. The shop has been anonymised.'
          : 'Rejected. The owner can see your reason.',
      );
      onDecided(item.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DELETION_BLOCKED') {
        setEvidence(deletionEvidenceOf(e.details, { refused: true }));
        setBlocked(true);
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="border-accent bg-card flex flex-col gap-4 rounded-2xl border p-5"
    >
      <div>
        <p className="text-muted-foreground text-base font-semibold">Data deletion</p>
        <h2 id={`${id}-title`} className="text-xl font-bold">
          {item.summary}
        </h2>
      </div>

      <div>
        <h3 className="text-lg font-semibold">What is still open</h3>
        <p className="text-muted-foreground text-base">
          As of when this page loaded. They are checked again when you approve.
        </p>
        <dl className="text-base">
          <Row term="Active rounds">{evidence.activeRounds}</Row>
          <Row term="Open pickups">{evidence.openPickups}</Row>
          <Row term="Open claims">{evidence.openClaims}</Row>
          <Row term="Pending payments">{evidence.pendingPayments}</Row>
          <Row term="Balance not yet withdrawn">
            <Money sen={evidence.balanceSen} />
          </Row>
        </dl>
      </div>

      <div
        role={blocked ? 'alert' : undefined}
        className={cn(
          'rounded-xl p-3 text-base',
          evidence.canApprove ? 'bg-primary/10' : 'bg-destructive/10',
        )}
      >
        {blocked ? (
          <p className="font-semibold">Blocked: this request cannot go ahead yet.</p>
        ) : null}
        {evidence.canApprove ? (
          <p>Nothing is open and the balance is zero, so this can be approved.</p>
        ) : (
          <p>
            Cannot be approved yet
            {stuck || evidence.balanceSen > 0
              ? `: there ${stuck ? `are ${stuck}` : 'is a balance'}${stuck && evidence.balanceSen > 0 ? ' and a balance' : ''}`
              : ''}
            . Ask the owner to finish or withdraw first.
          </p>
        )}
      </div>

      <dl className="flex flex-col gap-3 text-base">
        <div>
          <dt className="text-muted-foreground font-semibold">Why</dt>
          <dd>{item.whyNeeded}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-semibold">What is kept</dt>
          <dd>
            Payments, participations and ledger postings stay under an anonymous ID for the
            accounting retention period. The activity log is unchanged.
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-semibold">Asked</dt>
          <dd>
            <time dateTime={item.createdAt}>{formatMyt(new Date(item.createdAt))}</time>
          </dd>
        </div>
      </dl>

      {rejecting ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            void decide('reject');
          }}
        >
          <label htmlFor={`${id}-reason`} className={FIELD_LABEL}>
            Reason for rejecting (required)
          </label>
          <textarea
            id={`${id}-reason`}
            required
            maxLength={1000}
            rows={3}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            className={cn(INPUT, 'py-2')}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || reason.trim() === ''}
              className={cn(BUTTON_PRIMARY, 'bg-destructive hover:bg-destructive/90 text-white')}
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(false)}
              className={BUTTON_SECONDARY}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide('approve')}
            className={BUTTON_PRIMARY}
          >
            Approve deletion
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRejecting(true)}
            className={BUTTON_SECONDARY}
          >
            Reject
          </button>
        </div>
      )}
    </section>
  );
}
