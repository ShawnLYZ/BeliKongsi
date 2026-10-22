import type { SupplierPayoutView } from '@/lib/views/supplier';
import { EmptyState } from '@/components/common/empty-state';
import { Money } from '@/components/common/money';
import { SimulatedBadge } from '@/components/common/simulated-badge';
import { formatMyt } from '@/lib/format';

/** Payments released after each hub check, for good units only. No real money moves. */
export function PayoutList({ payouts }: { payouts: SupplierPayoutView[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          Payouts <SimulatedBadge />
        </h1>
        <p className="mt-1 text-base">
          You are paid for the good units checked at the hub. These payouts are simulated: no real
          money moves.
        </p>
      </div>
      {payouts.length === 0 ? (
        <EmptyState
          title="No payouts yet"
          explanation="When BeliKongsi checks an order at the hub, the payment for its good units appears here (Simulated)."
          example="Payment released: RM 15,330.00 for 105 cartons (simulated)."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {payouts.map((p) => (
            <li
              key={`${p.supplierOrderId}-${p.reference}`}
              className="bg-card flex flex-col gap-2 rounded-2xl border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold">{p.productName}</h2>
                <SimulatedBadge />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-base">
                <div>
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd>
                    <Money sen={p.amountSen} className="text-lg font-bold" />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Good units</dt>
                  <dd className="tabular-nums">{p.goodUnits}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd>
                    <time dateTime={p.paidAt}>{formatMyt(new Date(p.paidAt))}</time>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reference</dt>
                  <dd className="break-all tabular-nums">{p.reference}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
