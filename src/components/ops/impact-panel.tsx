import type { ImpactView } from '@/lib/views/ops';
import { TABLE, TABLE_WRAP, TD, TD_NUM, TH, TH_NUM } from './labels';

const DASH = '—';
/** One decimal under 10% (so 1 in 862 is not "0%"), and never "100%" for less than all. */
function percent(rate: number | null): string {
  if (rate === null) return DASH;
  const pct = rate * 100;
  if (pct < 10) return `${Math.round(pct * 10) / 10}%`;
  const whole = Math.round(pct);
  return whole === 100 && rate < 1 ? `${Math.floor(pct * 10) / 10}%` : `${whole}%`;
}
const minutes = (m: number | null) => (m === null ? DASH : `${m} min`);
/** Under an hour shows whole minutes, otherwise hours to one decimal. */
const confirmTime = (hours: number | null) =>
  hours === null
    ? DASH
    : hours < 1
      ? `${Math.round(hours * 60)} min`
      : `${Math.round(hours * 10) / 10} h`;

function Tile({
  label,
  value,
  definition,
  detail,
}: {
  label: string;
  value: string;
  definition: string;
  detail: string;
}) {
  return (
    <div className="bg-card flex flex-col gap-1 rounded-2xl border p-4">
      <dt className="text-base font-semibold">{label}</dt>
      <dd className="text-3xl font-bold tabular-nums">{value}</dd>
      <dd className="text-muted-foreground text-base tabular-nums">{detail}</dd>
      <dd className="text-muted-foreground text-base">{definition}</dd>
    </div>
  );
}

/** The five §27 metrics as stat tiles, then supplier reliability as a table. A dash means no data yet. */
export function ImpactPanelView({ impact: v }: { impact: ImpactView }) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="impact-title" className="flex flex-col gap-2">
        <h2 id="impact-title" className="text-lg font-semibold">
          Metrics
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            label="Time to approve"
            value={minutes(v.timeToApprove.medianMinutes)}
            detail={`Slowest 1 in 10: ${minutes(v.timeToApprove.p90Minutes)} · ${v.timeToApprove.samples} baskets`}
            definition="Median minutes from opening the basket to a successful payment. Auto-approved baskets are left out."
          />
          <Tile
            label="Basket approval rate"
            value={percent(v.basketApprovalRate.rate)}
            detail={`${v.basketApprovalRate.approved} of ${v.basketApprovalRate.drafted} drafted baskets`}
            definition="Baskets approved and paid, out of baskets drafted."
          />
          <Tile
            label="AI lines accepted unchanged"
            value={percent(v.aiLinesAcceptedUnchanged.rate)}
            detail={`${v.aiLinesAcceptedUnchanged.accepted} of ${v.aiLinesAcceptedUnchanged.suggested} suggested lines`}
            definition="Suggested usual-list lines (text or photo) saved without any change."
          />
          <Tile
            label="Claim rate"
            value={percent(v.claimRate.rate)}
            detail={`${v.claimRate.claimedUnits} of ${v.claimRate.deliveredUnits} delivered units`}
            definition="Units claimed as missing or damaged, out of units delivered."
          />
        </dl>
      </section>

      <section aria-labelledby="supplier-title" className="flex flex-col gap-2">
        <h2 id="supplier-title" className="text-lg font-semibold">
          Supplier reliability
        </h2>
        <p className="text-muted-foreground text-base">
          Time to confirm runs from when the supplier order is created, so it includes the wait for
          Ops approval. Good units are those found good at the hub check, out of units ordered.
        </p>
        {v.supplierReliability.length === 0 ? (
          <p className="bg-card rounded-2xl border p-4 text-base">{DASH} No supplier orders yet.</p>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Supplier
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Median time to confirm
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Good units
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.supplierReliability.map((s) => (
                  <tr key={s.supplierId} className="border-t">
                    <th scope="row" className={`${TD} font-medium`}>
                      {s.supplierName}
                    </th>
                    <td className={TD_NUM}>{confirmTime(s.medianConfirmationHours)}</td>
                    <td className={TD_NUM}>{percent(s.goodUnitsRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
