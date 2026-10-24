'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ApprovalView } from '@/server/modules/approvals/approvals';
import { EmptyState } from '@/components/common/empty-state';
import { Money } from '@/components/common/money';
import { formatMyt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ApprovalPanel, evidenceOf, moneyCheckPassed } from './approval-panel';
import { CheckMark } from './check-mark';
import { OverdueBadge } from './overdue-badge';
import { DeletionPanel } from './deletion-panel';
import { deletionEvidenceOf, openItemCount } from './deletion-evidence';
import { LINK, TABLE, TABLE_WRAP, TD, TD_NUM, TH, TH_NUM } from './labels';

/**
 * The Ops approvals inbox: supplier orders and claims in tables, and the chosen approval in a
 * panel beside them. A claim opens on its own review screen.
 */
export function OpsInbox({ initialItems }: { initialItems: ApprovalView[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const orders = items.filter((i) => i.type === 'supplier_order');
  const claims = items.filter((i) => i.type === 'claim');
  const deletions = items.filter((i) => i.type === 'data_deletion');
  const [selectedId, setSelectedId] = useState<string | null>(
    orders[0]?.id ?? deletions[0]?.id ?? null,
  );
  const selected = items.find((i) => i.id === selectedId) ?? null;

  function onDecided(id: string) {
    const rest = items.filter((i) => i.id !== id);
    setItems(rest);
    setSelectedId(
      rest.find((i) => i.type === 'supplier_order')?.id ??
        rest.find((i) => i.type === 'data_deletion')?.id ??
        null,
    );
    router.refresh(); // updates the pending count in the top bar
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <section aria-labelledby="orders-title" className="flex flex-col gap-2">
          <h2 id="orders-title" className="text-lg font-semibold">
            Supplier orders <span className="tabular-nums">({orders.length})</span>
          </h2>
          {orders.length === 0 ? (
            <EmptyState
              title="No supplier orders waiting"
              explanation="When a Kongsi round forms, its consolidated order waits here for your approval with the evidence."
              example="Supplier order: 105 cartons of condensed milk, RM 15,330.00."
            />
          ) : (
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <caption className="sr-only">Supplier orders waiting for approval</caption>
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className={TH}>
                      Order
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Amount
                    </th>
                    <th scope="col" className={TH}>
                      Check
                    </th>
                    <th scope="col" className={TH}>
                      Drafted
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const e = evidenceOf(o);
                    const current = o.id === selectedId;
                    return (
                      <tr
                        key={o.id}
                        className={cn('border-t', current ? 'bg-primary/10' : 'hover:bg-muted/50')}
                      >
                        <td className={TD}>
                          <button
                            type="button"
                            aria-pressed={current}
                            onClick={() => setSelectedId(o.id)}
                            className="focus-visible:ring-ring/60 min-h-11 rounded-lg text-left font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-3"
                          >
                            {e.productName ?? o.summary}
                            <span className="text-muted-foreground block font-normal">
                              {e.supplierName}
                            </span>
                          </button>
                          <OverdueBadge item={o} />
                        </td>
                        <td className={TD_NUM}>
                          {o.amountSen === null ? '—' : <Money sen={o.amountSen} />}
                        </td>
                        <td className={TD}>
                          <CheckMark passed={moneyCheckPassed(e)} />
                        </td>
                        <td className={cn(TD, 'whitespace-nowrap')}>
                          <time dateTime={o.createdAt}>{formatMyt(new Date(o.createdAt))}</time>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {deletions.length > 0 ? (
          <section aria-labelledby="deletions-title" className="flex flex-col gap-2">
            <h2 id="deletions-title" className="text-lg font-semibold">
              Deletion requests <span className="tabular-nums">({deletions.length})</span>
            </h2>
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <caption className="sr-only">Data deletion requests waiting for a decision</caption>
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className={TH}>
                      Request
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Balance
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Open items
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deletions.map((d) => {
                    const e = deletionEvidenceOf(d.evidence);
                    return (
                      <tr
                        key={d.id}
                        className={cn(
                          'border-t',
                          d.id === selectedId ? 'bg-primary/10' : 'hover:bg-muted/50',
                        )}
                      >
                        <td className={TD}>
                          <button
                            type="button"
                            aria-pressed={d.id === selectedId}
                            onClick={() => setSelectedId(d.id)}
                            className="focus-visible:ring-ring/60 min-h-11 rounded-lg text-left font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-3"
                          >
                            {d.summary}
                          </button>
                          <OverdueBadge item={d} />
                        </td>
                        <td className={TD_NUM}>
                          <Money sen={e.balanceSen} />
                        </td>
                        <td className={TD_NUM}>{openItemCount(e)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="claims-title" className="flex flex-col gap-2">
          <h2 id="claims-title" className="text-lg font-semibold">
            Claims <span className="tabular-nums">({claims.length})</span>
          </h2>
          {claims.length === 0 ? (
            <EmptyState
              title="No claims waiting"
              explanation="When a shop reports missing or damaged goods, the claim waits here with its photos for your review."
              example="Claim: 2 cartons of condensed milk damaged, RM 303.70."
            />
          ) : (
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <caption className="sr-only">Claims waiting for review</caption>
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className={TH}>
                      Claim
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Refund asked
                    </th>
                    <th scope="col" className={TH}>
                      Reported
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/50 border-t">
                      <td className={TD}>
                        <Link
                          href={c.link}
                          className={cn(LINK, 'inline-flex min-h-11 items-center')}
                        >
                          {c.summary}
                        </Link>
                        <OverdueBadge item={c} />
                      </td>
                      <td className={TD_NUM}>
                        {c.amountSen === null ? '—' : <Money sen={c.amountSen} />}
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap')}>
                        <time dateTime={c.createdAt}>{formatMyt(new Date(c.createdAt))}</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="lg:sticky lg:top-4">
        {selected ? (
          selected.type === 'data_deletion' ? (
            <DeletionPanel key={selected.id} item={selected} onDecided={onDecided} />
          ) : (
            <ApprovalPanel key={selected.id} item={selected} onDecided={onDecided} />
          )
        ) : (
          <EmptyState
            title="Nothing to decide"
            explanation="Choose a supplier order or a deletion request to see its evidence, then approve or reject it."
          />
        )}
      </div>
    </div>
  );
}
