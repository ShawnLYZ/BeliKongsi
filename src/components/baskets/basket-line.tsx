import type { OwnerBasketLine } from '@/lib/views/baskets';
import { Money } from '@/components/common/money';
import { WhyThisPriceSheet } from '@/components/rounds/why-this-price-sheet';
import { formatMyt, formatUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

/** "Rahim: +1" when staff added to this line, so the owner sees what changed. */
export function staffChange(line: OwnerBasketLine): string | null {
  if (line.changedBy?.role !== 'staff' || line.staffAddedQuantity <= 0) return null;
  return `${line.changedBy.name}: +${line.staffAddedQuantity}`;
}

/** One line of the owner's weekly basket: starting price, projected price and savings. */
export function BasketLine({
  line,
  deliveryFeeNote,
}: {
  line: OwnerBasketLine;
  deliveryFeeNote: string;
}) {
  const change = staffChange(line);
  const headingId = `line-${line.lineId}`;
  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        'bg-card flex flex-col gap-2 rounded-2xl border p-4',
        change && 'border-accent bg-accent/10 border-2',
        line.removed && 'opacity-80',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 id={headingId} className="text-lg leading-snug font-semibold">
            {line.name}
          </h3>
          <p className="text-muted-foreground text-base">{line.packDescription}</p>
        </div>
        {change ? (
          <span className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-base font-semibold tabular-nums">
            {change}
            <span className="sr-only"> (staff change)</span>
          </span>
        ) : null}
      </div>

      <p className="text-base font-semibold tabular-nums">
        {formatUnits(line.quantity, line.unitName)}
      </p>

      {line.removed ? (
        <p className="text-destructive text-base">{line.notice ?? 'Removed from this basket.'}</p>
      ) : line.startingAllInSen === null || line.startingLineSen === null ? (
        <p className="text-muted-foreground text-base">
          Waiting for its Kongsi round to open. It is priced when the round opens.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-base">
            <dt>Starting price</dt>
            <dd className="text-right">
              <Money sen={line.startingAllInSen} /> a {line.unitName}
            </dd>
            <dt>This line now</dt>
            <dd className="text-right font-semibold">
              <Money sen={line.startingLineSen} />
            </dd>
            <dt>Estimated after cut-off</dt>
            <dd className="text-right">
              {line.projectedAllInSen !== null ? (
                <>
                  <Money sen={line.projectedAllInSen} /> a {line.unitName}
                </>
              ) : (
                'Below the minimum order'
              )}
            </dd>
            <dt>Estimated savings</dt>
            <dd className="text-primary text-right font-semibold">
              {line.estimatedSavingsSen !== null ? <Money sen={line.estimatedSavingsSen} /> : '—'}
            </dd>
          </dl>
          <p className="text-muted-foreground text-base">
            Savings compared with{' '}
            {line.savingsBasis === 'usual_price' ? 'your usual price' : 'buying alone'}.
            {line.priceLimitSen !== null ? (
              <>
                {' '}
                Price limit <Money sen={line.priceLimitSen} />.
              </>
            ) : null}
            {line.cutoffAt ? (
              <>
                {' '}
                Cut-off <time dateTime={line.cutoffAt}>{formatMyt(new Date(line.cutoffAt))}</time>.
              </>
            ) : null}
          </p>
          {line.notice ? <p className="text-base">{line.notice}</p> : null}
          <WhyThisPriceSheet
            productName={line.name}
            explanation={line.explanation}
            deliveryFeeNote={deliveryFeeNote}
          />
        </>
      )}
    </article>
  );
}
