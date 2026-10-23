'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { ApprovalView } from '@/server/modules/approvals/approvals';
import { apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_LABEL, INPUT } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { formatMyt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CheckMark } from './check-mark';
import { LINK } from './labels';

/** The evidence a supplier order approval carries (written by draftSupplierOrder). */
export type SupplierOrderEvidence = {
  productName?: string;
  supplierName?: string;
  finalTier?: number | null;
  quantity?: number;
  shopCount?: number;
  moneyHeldSen?: number;
  orderCostSen?: number;
  feesSen?: number;
  shippingSen?: number;
  moneyCheck?: { passed: boolean; detail: string };
  roundLink?: string;
};

/** The money check's result, or null when the evidence has none (unknown is not a failure). */
export function moneyCheckPassed(e: SupplierOrderEvidence): boolean | null {
  return typeof e.moneyCheck?.passed === 'boolean' ? e.moneyCheck.passed : null;
}

export function evidenceOf(item: ApprovalView): SupplierOrderEvidence {
  const e = item.evidence;
  return e && typeof e === 'object' && !Array.isArray(e) ? (e as SupplierOrderEvidence) : {};
}

function proposer(p: ApprovalView['proposedBy']): string {
  if (p.name) return p.name;
  if (p.type === 'system') return 'BeliKongsi (system)';
  if (p.type === 'ai') return 'AI';
  return 'Someone';
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t py-2 first:border-t-0">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right font-medium whitespace-nowrap tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * One approval with what, how much, why, the evidence and who proposed it (PRD §12, story 118),
 * and the Approve and Reject buttons. A reject needs a reason.
 */
export function ApprovalPanel({
  item,
  onDecided,
}: {
  item: ApprovalView;
  onDecided: (id: string) => void;
}) {
  const reasonId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const e = evidenceOf(item);
  const sum = (e.orderCostSen ?? 0) + (e.feesSen ?? 0) + (e.shippingSen ?? 0);
  const checkPassed = moneyCheckPassed(e);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await apiFetch(`/api/approvals/${item.id}/${decision}`, {
        method: 'POST',
        body: decision === 'reject' ? { reason: reason.trim() } : {},
      });
      toast.success(
        decision === 'approve'
          ? 'Approved. The order has gone to the supplier.'
          : 'Rejected. The round is cancelled and every shop is refunded in full.',
      );
      onDecided(item.id);
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`${reasonId}-title`}
      className="border-t-card-top bg-card flex flex-col gap-4 rounded-2xl border border-t-4 p-5"
    >
      <div>
        <p className="text-muted-foreground text-base font-semibold">Supplier order</p>
        <h2 id={`${reasonId}-title`} className="text-xl font-bold tabular-nums">
          {item.summary}
        </h2>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <h3 className="text-lg font-semibold">What</h3>
          <dl className="text-base">
            <Row term="Product">{e.productName ?? '—'}</Row>
            <Row term="Supplier">{e.supplierName ?? '—'}</Row>
            <Row term="Tier reached">{e.finalTier ?? '—'}</Row>
            <Row term="Quantity">{e.quantity ?? '—'}</Row>
            <Row term="Shops">{e.shopCount ?? '—'}</Row>
          </dl>
        </div>
        <div>
          <h3 className="text-lg font-semibold">How much</h3>
          <dl className="text-base">
            <Row term="Order cost">
              {e.orderCostSen === undefined ? '—' : <Money sen={e.orderCostSen} />}
            </Row>
            <Row term="Fees">{e.feesSen === undefined ? '—' : <Money sen={e.feesSen} />}</Row>
            <Row term="Shipping">
              {e.shippingSen === undefined ? '—' : <Money sen={e.shippingSen} />}
            </Row>
            <Row term="Order cost + fees + shipping">
              <Money sen={sum} />
            </Row>
            <Row term="Money held">
              {e.moneyHeldSen === undefined ? '—' : <Money sen={e.moneyHeldSen} />}
            </Row>
          </dl>
        </div>
      </div>

      <div
        className={cn(
          'rounded-xl p-3 text-base',
          checkPassed === null
            ? 'bg-muted border-input/60 border-2 border-dashed'
            : checkPassed
              ? 'bg-primary/10'
              : 'bg-destructive/10',
        )}
      >
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Money check:</span>
          <CheckMark passed={checkPassed} withText />
        </p>
        {checkPassed === null ? (
          <p className="mt-1">
            This approval carries no money check. Open the round below and check its money before
            you approve.
          </p>
        ) : e.moneyCheck?.detail ? (
          <p className="mt-1 tabular-nums">{e.moneyCheck.detail}</p>
        ) : null}
      </div>

      <dl className="flex flex-col gap-3 text-base">
        <div>
          <dt className="text-muted-foreground font-semibold">Why approval is needed</dt>
          <dd>{item.whyNeeded}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-semibold">Proposed by</dt>
          <dd>
            {proposer(item.proposedBy)} ·{' '}
            <time dateTime={item.createdAt}>{formatMyt(new Date(item.createdAt))}</time>
          </dd>
        </div>
      </dl>

      {e.roundLink ? (
        <p className="text-base">
          <Link href={e.roundLink} className={LINK}>
            See the round and every shop in it
          </Link>
        </p>
      ) : null}

      {rejecting ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            void decide('reject');
          }}
        >
          <label htmlFor={reasonId} className={FIELD_LABEL}>
            Reason for rejecting (required)
          </label>
          <textarea
            id={reasonId}
            required
            maxLength={1000}
            rows={3}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            className={cn(INPUT, 'py-2')}
          />
          <p className="text-muted-foreground text-base">
            Rejecting cancels the round and refunds every shop in full.
          </p>
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
            Approve
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
