'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ApprovalType } from '@/generated/prisma/enums';
import type { ApprovalView } from '@/server/modules/approvals/approvals';
import { apiFetch } from '@/components/common/api-client';
import { Money } from '@/components/common/money';
import { formatMyt, formatRM } from '@/lib/format';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<ApprovalType, string> = {
  weekly_basket: 'Weekly basket',
  supplier_order: 'Supplier order',
  supplier_confirmation: 'Supplier confirmation',
  claim: 'Claim',
};

const ACTION =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:opacity-60';

function humanKey(key: string): string {
  const spaced = key
    .replace(/Sen$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return spaced.replace(/^./, (c) => c.toUpperCase());
}

function evidenceValue(key: string, value: unknown): string {
  if (typeof value === 'number' && key.endsWith('Sen')) return formatRM(value);
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function Evidence({ value }: { value: ApprovalView['evidence'] }) {
  if (value === null || value === undefined) return <p className="text-base">None</p>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-base">None</p>;
    return (
      <ul className="list-disc pl-5 text-base">
        {value.map((v, i) => (
          <li key={i}>{evidenceValue('', v)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return <p className="text-base">None</p>;
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{humanKey(k)}</dt>
            <dd className="break-words tabular-nums">{evidenceValue(k, v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="text-base">{String(value)}</p>;
}

function proposer(p: ApprovalView['proposedBy']): string {
  if (p.name) return p.name;
  if (p.type === 'ai') return 'AI';
  if (p.type === 'system') return 'BeliKongsi (system)';
  return 'Someone';
}

function ApprovalCard({
  item,
  canDecide,
  onDecided,
}: {
  item: ApprovalView;
  canDecide: boolean;
  onDecided: (id: string) => void;
}) {
  const reasonId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await apiFetch(`/api/approvals/${item.id}/${decision}`, {
        method: 'POST',
        ...(decision === 'reject' ? { body: { reason } } : {}),
      });
      toast.success(decision === 'approve' ? 'Approved.' : 'Rejected.');
      onDecided(item.id);
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t-card-top bg-card rounded-2xl border border-t-4 p-4">
      <p className="text-muted-foreground text-sm font-semibold">{TYPE_LABELS[item.type]}</p>
      <h2 className="mt-0.5 text-lg font-semibold">{item.summary}</h2>
      <dl className="mt-3 flex flex-col gap-3 text-base">
        <div>
          <dt className="text-muted-foreground text-sm font-semibold">How much</dt>
          <dd>
            {item.amountSen === null ? (
              'No amount'
            ) : (
              <Money sen={item.amountSen} className="font-semibold" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm font-semibold">Why approval is needed</dt>
          <dd>{item.whyNeeded}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm font-semibold">Evidence</dt>
          <dd>
            <Evidence value={item.evidence} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm font-semibold">Proposed by</dt>
          <dd>
            {proposer(item.proposedBy)} ·{' '}
            <time dateTime={item.createdAt}>{formatMyt(new Date(item.createdAt))}</time>
          </dd>
        </div>
      </dl>

      {canDecide ? (
        <div className="mt-4 flex flex-col gap-2">
          {rejecting ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void decide('reject');
              }}
            >
              <label htmlFor={reasonId} className="text-base font-semibold">
                Reason for rejecting
              </label>
              <textarea
                id={reasonId}
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="border-input bg-background focus-visible:ring-ring/60 rounded-xl border p-3 text-base outline-none focus-visible:ring-3"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy || reason.trim() === ''}
                  className={cn(ACTION, 'bg-destructive hover:bg-destructive/90 text-white')}
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRejecting(false)}
                  className={cn(ACTION, 'border-input/50 bg-card hover:bg-muted border')}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              {item.type === 'supplier_confirmation' ? (
                // Confirming needs a dispatch date, which is asked for on the order itself.
                <Link
                  href={item.link}
                  className={cn(
                    ACTION,
                    'bg-primary text-primary-foreground hover:bg-primary-hover',
                  )}
                >
                  Open the order
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide('approve')}
                  className={cn(
                    ACTION,
                    'bg-primary text-primary-foreground hover:bg-primary-hover',
                  )}
                >
                  Approve
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejecting(true)}
                className={cn(ACTION, 'border-input/50 bg-card hover:bg-muted border')}
              >
                Reject…
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground mt-4 text-base">
          You approve this from your weekly basket with &ldquo;Approve &amp; pay&rdquo;.
        </p>
      )}
    </li>
  );
}

/** The approvals inbox: what, how much, why, evidence and who proposed it (PRD §12). */
export function ApprovalList({
  initialItems,
  canDecide,
}: {
  initialItems: ApprovalView[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <ApprovalCard
          key={item.id}
          item={item}
          canDecide={canDecide}
          onDecided={(id) => {
            setItems((list) => list.filter((i) => i.id !== id));
            router.refresh(); // updates the pending count in the top bar
          }}
        />
      ))}
    </ul>
  );
}
