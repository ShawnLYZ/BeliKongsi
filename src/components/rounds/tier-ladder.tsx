import type { TierView } from '@/lib/views/catalogue';
import { Money } from '@/components/common/money';
import { formatUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The price tiers of a round, with the buy-alone price beside them and the current tier marked. */
export function TierLadder({
  tiers,
  buyAlonePriceSen,
  currentTier,
  unitName,
  currentLabel = 'Now',
}: {
  tiers: TierView[];
  buyAlonePriceSen: number;
  currentTier: number | null;
  unitName: string;
  /** The badge on the marked tier: "Now" while open, "Final" once closed. */
  currentLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">Price per {unitName}</h3>
      <ol className="flex flex-col gap-1" aria-label="Prices: bought alone and Kongsi tiers">
        <li className="bg-muted flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-base">
          <span>Bought alone</span>
          <Money sen={buyAlonePriceSen} className="whitespace-nowrap" />
        </li>
        {tiers.map((t) => {
          const current = t.position === currentTier;
          return (
            <li
              key={t.position}
              className={cn(
                'flex items-center justify-between gap-2 rounded-lg border-2 px-3 py-1.5 text-base',
                current ? 'border-primary bg-primary/10 font-semibold' : 'border-transparent',
              )}
            >
              <span className="whitespace-nowrap tabular-nums">
                {formatUnits(t.minQuantity, unitName)}+
              </span>
              <span className="flex items-center gap-2">
                {current ? (
                  <span className="bg-primary text-primary-foreground rounded-full px-2 text-base">
                    {currentLabel}
                  </span>
                ) : null}
                <Money sen={t.unitPriceSen} className="whitespace-nowrap" />
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
