import type { TierView } from '@/lib/views/catalogue';
import type { RoundProgressView } from '@/lib/views/rounds';
import { Money } from '@/components/common/money';
import { formatUnits } from '@/lib/format';

/**
 * How far a round has got: units ordered, shops taking part and units to the next tier. The bar
 * runs from zero to the top tier, with a mark at each tier.
 */
export function ProgressBar({
  progress,
  tiers,
  unitName,
}: {
  progress: RoundProgressView;
  tiers: TierView[];
  unitName: string;
}) {
  const top = tiers.at(-1)?.minQuantity ?? 1;
  const pct = Math.min(100, Math.round((progress.totalQuantity / top) * 100));
  const shops = progress.shopCount === 1 ? '1 shop' : `${progress.shopCount} shops`;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base">
        <span className="font-semibold tabular-nums">
          {formatUnits(progress.totalQuantity, unitName)}
        </span>{' '}
        so far, from <span className="tabular-nums">{shops}</span>
      </p>
      <div
        role="progressbar"
        aria-label={`Units ordered toward the top tier of ${formatUnits(top, unitName)}`}
        aria-valuemin={0}
        aria-valuemax={top}
        aria-valuenow={Math.min(progress.totalQuantity, top)}
        className="bg-muted relative h-3 w-full overflow-hidden rounded-full"
      >
        <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
        {tiers.slice(0, -1).map((t) => (
          <span
            key={t.position}
            aria-hidden="true"
            className="bg-foreground/40 absolute top-0 h-full w-0.5"
            style={{ left: `${(t.minQuantity / top) * 100}%` }}
          />
        ))}
      </div>
      <p className="text-base">
        {progress.unitsToNextTier !== null && progress.nextTierUnitPriceSen !== null ? (
          <>
            <span className="font-semibold tabular-nums">
              {formatUnits(progress.unitsToNextTier, unitName)}
            </span>{' '}
            {progress.currentTier === null ? (
              'more for the round to go ahead (minimum order)'
            ) : (
              <>
                more to reach{' '}
                <Money sen={progress.nextTierUnitPriceSen} className="font-semibold" />
              </>
            )}
          </>
        ) : (
          'The best price is reached.'
        )}
      </p>
    </div>
  );
}
