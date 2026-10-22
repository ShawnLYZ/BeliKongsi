import Link from 'next/link';
import type { MoneyOverview } from '@/lib/views/ops';
import { Money } from '@/components/common/money';
import { cn } from '@/lib/utils';
import { CheckMark } from './check-mark';
import { LINK, postingKindLabel, TABLE, TABLE_WRAP, TD, TD_NUM, TH, TH_NUM } from './labels';

function Total({ label, sen, note }: { label: string; sen: number; note?: string }) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <dt className="text-muted-foreground text-base font-semibold">{label}</dt>
      <dd className="text-2xl font-bold">
        <Money sen={sen} />
      </dd>
      {note ? <dd className="text-muted-foreground text-base">{note}</dd> : null}
    </div>
  );
}

/** Where the money is, and the invariant checks as ✅ or ❌ with links to failing rounds (story 130). */
export function MoneyOverviewView({ overview: o }: { overview: MoneyOverview }) {
  const allPassed = o.checks.every((c) => c.passed);
  const refunds = Object.entries(o.refundsByKind).sort(([a], [b]) => a.localeCompare(b));
  const refundTotal = refunds.reduce((s, [, sen]) => s + sen, 0);
  const heldTotal = o.heldPerOpenRound.reduce((s, h) => s + h.heldSen, 0);
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="checks-title" className="flex flex-col gap-2">
        <h2 id="checks-title" className="flex items-center gap-2 text-lg font-semibold">
          Money checks <CheckMark passed={allPassed} withText />
        </h2>
        <ul className="bg-card flex flex-col rounded-2xl border text-base">
          {o.checks.map((c) => (
            <li key={c.id} className="border-t px-4 py-3 first:border-t-0">
              <span className="flex gap-2">
                <CheckMark passed={c.passed} />
                <span className={cn(!c.passed && 'font-semibold')}>{c.label}</span>
              </span>
              {c.failures.length > 0 ? (
                <ul className="mt-1 ml-7 flex flex-col gap-1">
                  {c.failures.map((f, i) => (
                    <li key={i} className="text-destructive">
                      {f.detail}{' '}
                      {f.link ? (
                        <Link href={f.link} className={LINK}>
                          Open the round
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="totals-title" className="flex flex-col gap-2">
        <h2 id="totals-title" className="text-lg font-semibold">
          Totals
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Total label="Held in rounds" sen={heldTotal} note="Paid by shops, not yet settled" />
          <Total label="Refunds issued" sen={refundTotal} note="Back to shop balances" />
          <Total label="Supplier payouts" sen={o.supplierPayoutsSen} note="Simulated" />
          <Total label="Fee revenue" sen={o.feeRevenueSen} />
          <Total label="Logistics payable" sen={o.logisticsPayableSen} />
          <Total label="Delivery fees held" sen={o.deliveryFeesHeldSen} />
          <Total label="Claims expense" sen={o.claimsExpenseSen} />
          <Total label="Partner cash" sen={o.partnerCashSen} note="Simulated payment partner" />
        </dl>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section aria-labelledby="held-title" className="flex flex-col gap-2">
          <h2 id="held-title" className="text-lg font-semibold">
            Money held per round
          </h2>
          {o.heldPerOpenRound.length === 0 ? (
            <p className="text-muted-foreground text-base">No round is holding money.</p>
          ) : (
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <caption className="sr-only">Money held per round</caption>
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className={TH}>
                      Round
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Held
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {o.heldPerOpenRound.map((h) => (
                    <tr key={h.roundId} className="border-t">
                      <td className={TD}>
                        <Link href={`/ops/rounds/${h.roundId}`} className={LINK}>
                          {h.productName}
                        </Link>
                      </td>
                      <td className={TD_NUM}>
                        <Money sen={h.heldSen} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="refunds-title" className="flex flex-col gap-2">
          <h2 id="refunds-title" className="text-lg font-semibold">
            Refunds by kind
          </h2>
          {refunds.length === 0 ? (
            <p className="text-muted-foreground text-base">No refunds yet.</p>
          ) : (
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <caption className="sr-only">Refunds issued, by kind</caption>
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className={TH}>
                      Kind
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map(([kind, sen]) => (
                    <tr key={kind} className="border-t">
                      <td className={TD}>{postingKindLabel(kind)}</td>
                      <td className={TD_NUM}>
                        <Money sen={sen} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
