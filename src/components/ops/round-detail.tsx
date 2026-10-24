import type { ReactNode } from 'react';
import Link from 'next/link';
import type { OpsRoundDetail } from '@/lib/views/ops';
import { Money } from '@/components/common/money';
import { statusWords } from '@/components/rounds/status-words';
import { formatMyt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CancelRoundForm } from './cancel-round-form';
import { CheckMark } from './check-mark';
import {
  LINK,
  orderStatusLabel,
  postingKindLabel,
  TABLE,
  TABLE_WRAP,
  TD,
  TD_NUM,
  TH,
  TH_NUM,
} from './labels';

function Field({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground font-semibold">{term}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

const dash = '—';

/**
 * Ops round detail (story 131): every shop with its quantity, join time, limit, status, final
 * all-in price, refund and allocation; the engine result; the ledger; and the money check.
 */
export function OpsRoundDetailView({ detail }: { detail: OpsRoundDetail }) {
  const { round, participants, engineResult: er, ledger, moneyCheck } = detail;
  const postings = Object.entries(ledger.postingsByKind).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-muted-foreground text-base font-semibold">
          {round.supplierName} · {round.hubName} · {round.cycleLabel}
        </p>
        <h1 className="text-[1.75rem] leading-tight font-bold">{round.productName}</h1>
        <p className="mt-1 text-base">
          {statusWords(round.status)} · cut-off{' '}
          <time dateTime={round.cutoffAt}>{formatMyt(new Date(round.cutoffAt))}</time> ·{' '}
          <span className="tabular-nums">
            {round.shopCount} {round.shopCount === 1 ? 'shop' : 'shops'}
          </span>
        </p>
        {round.supplierOrderId ? (
          <p className="mt-2 text-base">
            <Link href={`/ops/supplier-orders/${round.supplierOrderId}`} className={LINK}>
              Supplier order: {orderStatusLabel(round.supplierOrderStatus ?? '')}
            </Link>
          </p>
        ) : null}
      </div>

      {round.status === 'open' ? <CancelRoundForm roundId={round.roundId} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-labelledby="engine-title" className="bg-card rounded-2xl border p-4">
          <h2 id="engine-title" className="text-lg font-semibold">
            Engine result
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-base">
            <Field term="Final tier">{er.finalTier ?? dash}</Field>
            <Field term="Final unit price">
              {er.finalUnitPriceSen === null ? dash : <Money sen={er.finalUnitPriceSen} />}
            </Field>
            <Field term="Total at cut-off">{er.totalAtCutoff ?? dash}</Field>
            <Field term="Total kept">{er.totalKept ?? dash}</Field>
            <Field term="Close passes">{er.closeIterations ?? dash}</Field>
            <Field term="Closed">
              {er.closedAt ? (
                <time dateTime={er.closedAt}>{formatMyt(new Date(er.closedAt))}</time>
              ) : (
                dash
              )}
            </Field>
          </dl>
        </section>

        <section aria-labelledby="ledger-title" className="bg-card rounded-2xl border p-4">
          <h2 id="ledger-title" className="text-lg font-semibold">
            Ledger
          </h2>
          <dl className="mt-2 text-base">
            <div className="flex justify-between gap-3 border-b pb-2">
              <dt className="font-semibold">Money held now</dt>
              <dd className="font-semibold">
                <Money sen={ledger.holdBalanceSen} />
              </dd>
            </div>
            {postings.length === 0 ? (
              <p className="text-muted-foreground pt-2">No postings yet.</p>
            ) : (
              postings.map(([kind, sen]) => (
                <div key={kind} className="flex justify-between gap-3 pt-2">
                  <dt className="text-muted-foreground">{postingKindLabel(kind)}</dt>
                  <dd>
                    <Money sen={sen} />
                  </dd>
                </div>
              ))
            )}
          </dl>
        </section>

        <section aria-labelledby="check-title" className="bg-card rounded-2xl border p-4">
          <h2 id="check-title" className="flex items-center gap-2 text-lg font-semibold">
            Money check <CheckMark passed={moneyCheck.passed} withText />
          </h2>
          <ul className="mt-2 flex flex-col gap-2 text-base">
            {moneyCheck.checks.map((c) => (
              <li key={c.id}>
                <span className="flex gap-2">
                  <CheckMark passed={c.passed} />
                  <span>{c.label}</span>
                </span>
                {c.failures.map((f, i) => (
                  <p key={i} className="text-destructive ml-7">
                    {f.detail}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="shops-title" className="flex flex-col gap-2">
        <h2 id="shops-title" className="text-lg font-semibold">
          Shops in this round <span className="tabular-nums">({participants.length} lines)</span>
        </h2>
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <caption className="sr-only">Every participation, in join order</caption>
            <thead className="bg-muted">
              <tr>
                <th scope="col" className={TH}>
                  Shop
                </th>
                <th scope="col" className={TH_NUM}>
                  Quantity
                </th>
                <th scope="col" className={TH}>
                  Joined
                </th>
                <th scope="col" className={TH_NUM}>
                  Price limit
                </th>
                <th scope="col" className={TH}>
                  Status
                </th>
                <th scope="col" className={TH_NUM}>
                  Final all-in
                </th>
                <th scope="col" className={TH_NUM}>
                  Paid
                </th>
                <th scope="col" className={TH_NUM}>
                  Refunded
                </th>
                <th scope="col" className={TH_NUM}>
                  Allocated
                </th>
                <th scope="col" className={TH_NUM}>
                  Missing
                </th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.participationId} className="border-t">
                  <td className={cn(TD, 'font-medium')}>{p.shopName}</td>
                  <td className={TD_NUM}>{p.quantity}</td>
                  <td className={cn(TD, 'whitespace-nowrap')}>
                    <time dateTime={p.joinedAt}>{formatMyt(new Date(p.joinedAt))}</time>
                  </td>
                  <td className={TD_NUM}>
                    {p.priceLimitSen === null ? dash : <Money sen={p.priceLimitSen} />}
                  </td>
                  <td className={TD}>{p.status.replace(/_/g, ' ')}</td>
                  <td className={TD_NUM}>
                    {p.finalAllInSen === null ? dash : <Money sen={p.finalAllInSen} />}
                  </td>
                  <td className={TD_NUM}>
                    <Money sen={p.paidSen} />
                  </td>
                  <td className={TD_NUM}>
                    <Money sen={p.refundSen} />
                  </td>
                  <td className={TD_NUM}>{p.allocated ?? dash}</td>
                  <td className={TD_NUM}>{p.missing ?? dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
