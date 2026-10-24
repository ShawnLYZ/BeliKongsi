import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { PickupView } from '@/lib/views/pickups';
import { formatMytDate, formatUnits } from '@/lib/format';
import { PickupCode } from './pickup-code';
import { PickupStatusBadge } from './status-badge';
import { isHandedOver, placeLabel } from './steps';

const CARD_LINK =
  'focus-visible:ring-ring/60 hover:bg-muted flex items-start justify-between gap-3 rounded-2xl p-4 outline-none focus-visible:ring-3';

/** "Condensed milk × 6 cartons, Eggs × 2 trays" */
export function goodsLine(p: PickupView): string {
  return p.lines.map((l) => `${l.productName} × ${formatUnits(l.quantity, l.unitName)}`).join(', ');
}

function PickupSummary({ pickup }: { pickup: PickupView }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-lg font-semibold">{placeLabel(pickup)}</p>
      <p className="text-base">
        <time dateTime={pickup.deliveryDate}>{formatMytDate(pickup.deliveryDate)}</time>
        {pickup.openingHours ? ` · ${pickup.openingHours}` : ''}
      </p>
      <p>
        <PickupStatusBadge pickup={pickup} />
      </p>
      {pickup.late ? (
        <p className="text-destructive text-base font-semibold">
          Late
          {pickup.late.newExpectedAt
            ? `, new date ${formatMytDate(new Date(pickup.late.newExpectedAt))}`
            : ''}
        </p>
      ) : null}
      {pickup.code && !isHandedOver(pickup) ? (
        <PickupCode code={pickup.code} size="small" className="mt-1" />
      ) : null}
      <p className="text-muted-foreground text-base">{goodsLine(pickup)}</p>
    </div>
  );
}

/**
 * A shop's pickups as cards: place, date, opening hours, where the goods are, and the code.
 * Goods not at the hub yet have no pickup page; their card links to `groupHrefBase` (the owner's
 * page with "Cancel late item") when given, else it is not a link. No money (R6).
 */
export function PickupList({
  items,
  hrefBase,
  groupHrefBase,
  label,
}: {
  items: PickupView[];
  hrefBase: string;
  groupHrefBase?: string;
  label: string;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {items.map((p, i) => (
        <li key={p.pickupId ?? `group-${i}`} className="bg-card rounded-2xl border">
          {p.pickupId || (groupHrefBase && p.groupKey) ? (
            <Link
              href={p.pickupId ? `${hrefBase}/${p.pickupId}` : `${groupHrefBase}/${p.groupKey}`}
              className={CARD_LINK}
            >
              <PickupSummary pickup={p} />
              <ChevronRight aria-hidden="true" className="mt-1 size-5 shrink-0" />
            </Link>
          ) : (
            <div className="p-4">
              <PickupSummary pickup={p} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
