import type { SupplierOpenRoundView } from '@/lib/views/supplier';
import { EmptyState } from '@/components/common/empty-state';
import { formatMyt, formatUnits } from '@/lib/format';

/** Open Kongsi rounds for this supplier: totals and shop counts only, never a shop (PRD §15). */
export function OpenRoundList({ rounds }: { rounds: SupplierOpenRoundView[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Open rounds</h1>
        <p className="mt-1 text-base">
          What shops have ordered so far this cycle. Totals can still change until the cut-off.
        </p>
      </div>
      {rounds.length === 0 ? (
        <EmptyState
          title="No open rounds"
          explanation="While a Kongsi round for one of your products is open, its running total and number of shops appear here."
          example="Condensed milk: 105 cartons from 9 shops, tier 3, closes Thu 5 Nov, 8:00 pm."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rounds.map((r) => (
            <li key={r.roundId} className="bg-card flex flex-col gap-2 rounded-2xl border p-4">
              <h2 className="text-lg font-semibold">{r.productName}</h2>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-base">
                <div>
                  <dt className="text-muted-foreground">Total so far</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatUnits(r.totalQuantity, r.unitName)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Shops</dt>
                  <dd className="tabular-nums">{r.shopCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tier reached</dt>
                  <dd className="tabular-nums">{r.currentTier ?? 'None yet'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Closes</dt>
                  <dd>
                    <time dateTime={r.cutoffAt}>{formatMyt(new Date(r.cutoffAt))}</time>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
