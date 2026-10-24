import type { PickupView } from '@/lib/views/pickups';
import { formatMyt, formatUnits } from '@/lib/format';

/** "Collected so far": each hand-over of a pickup with its goods and whether it was checked (P1-8). */
export function CollectionsList({ pickup }: { pickup: PickupView }) {
  if (pickup.collections.length === 0) return null;
  const door = pickup.destinationType === 'door';
  return (
    <section
      aria-labelledby="collections-title"
      className="bg-card flex flex-col gap-3 rounded-2xl border p-5"
    >
      <h2 id="collections-title" className="text-lg font-semibold">
        {door ? 'Delivered so far' : 'Collected so far'}
      </h2>
      <ol className="flex flex-col gap-3">
        {pickup.collections.map((c, i) => (
          <li key={c.collectionId} className="flex flex-col gap-1">
            <p className="text-base font-semibold">
              Part {i + 1}, {door ? 'delivered' : 'collected'}{' '}
              <time dateTime={c.collectedAt}>{formatMyt(new Date(c.collectedAt))}</time>
            </p>
            <ul className="text-base">
              {c.lines.map((l) => (
                <li key={l.allocationId ?? l.productName} className="flex justify-between gap-3">
                  <span>{l.productName}</span>
                  <span className="whitespace-nowrap tabular-nums">
                    {formatUnits(l.quantity, l.unitName)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-base">
              {c.checkResult === 'not_checked'
                ? 'Received, not checked'
                : c.checked
                  ? 'Checked'
                  : 'Not checked yet'}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
