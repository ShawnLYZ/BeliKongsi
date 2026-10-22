import type { PickupView } from '@/lib/views/pickups';
import { formatMytDate, formatUnits } from '@/lib/format';
import { PickupStatusBadge } from './status-badge';
import { placeLabel } from './steps';

/** A pickup's place, date, opening hours, address and goods, for owner and staff (no money). */
export function PickupFacts({ pickup }: { pickup: PickupView }) {
  return (
    <section
      aria-labelledby="pickup-place"
      className="bg-card flex flex-col gap-3 rounded-2xl border p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="pickup-place" className="text-xl font-bold">
          {placeLabel(pickup)}
        </h2>
        <p className="text-base">
          <time dateTime={pickup.deliveryDate}>{formatMytDate(pickup.deliveryDate)}</time>
          {pickup.openingHours ? ` · Open ${pickup.openingHours}` : ''}
        </p>
        {pickup.address ? (
          <p className="text-muted-foreground text-base">{pickup.address}</p>
        ) : null}
        <p className="mt-1">
          <PickupStatusBadge pickup={pickup} />
        </p>
      </div>
      <div>
        <h3 className="text-base font-semibold">Your goods</h3>
        <ul className="mt-1 flex flex-col divide-y">
          {pickup.lines.map((l, i) => (
            <li key={l.allocationId ?? i} className="flex justify-between gap-3 py-2 text-base">
              <span>{l.productName}</span>
              <span className="whitespace-nowrap tabular-nums">
                {formatUnits(l.quantity, l.unitName)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
