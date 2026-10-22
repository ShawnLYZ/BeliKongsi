import type { ShopSettingsView } from '@/lib/views/directory';
import type { RoundDetailView } from '@/lib/views/rounds';
import { ProductImage } from '@/components/catalogue/product-image';
import { EmptyState } from '@/components/common/empty-state';
import { Money } from '@/components/common/money';
import { formatMyt, formatMytDate, formatUnits } from '@/lib/format';
import { Countdown } from './countdown';
import { JoinSheet } from './join-sheet';
import { ProgressBar } from './progress-bar';
import { statusWords } from './status-words';
import { TierLadder } from './tier-ladder';

/** A round's tiers, progress and this shop's own lines (PRD §22 "Round detail"). */
export function RoundDetail({
  round,
  supplierName,
  category,
  serverNow,
  settings,
}: {
  round: RoundDetailView;
  supplierName: string | null;
  category: string;
  serverNow: string;
  /** The shop's fulfilment settings, for the join sheet. */
  settings: ShopSettingsView | null;
}) {
  const open = round.status === 'open';
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <ProductImage
          product={{
            name: round.name,
            category,
            imageUrl: round.imageUrl,
            imageAiGenerated: round.imageAiGenerated,
          }}
          className="w-40"
        />
        <div>
          <h1 className="text-2xl font-bold">{round.name}</h1>
          <p className="text-base">{round.packDescription}</p>
          {supplierName ? (
            <p className="text-muted-foreground text-base">From {supplierName}</p>
          ) : null}
        </div>
        <p className="text-base">
          Round status: <span className="font-semibold">{statusWords(round.status)}</span>
        </p>
        {open ? (
          <>
            <Countdown cutoffAt={round.cutoffAt} serverNow={serverNow} />
            <p className="text-base">
              Goods ready from{' '}
              <time dateTime={round.expectedReadyAt}>
                {formatMytDate(new Date(round.expectedReadyAt))}
              </time>
              .
            </p>
          </>
        ) : round.nextRoundCutoffAt ? (
          <p className="text-base">
            The next round for this product closes{' '}
            <time dateTime={round.nextRoundCutoffAt}>
              {formatMyt(new Date(round.nextRoundCutoffAt))}
            </time>
            .
          </p>
        ) : null}
      </div>

      <section className="bg-card flex flex-col gap-4 rounded-2xl border p-4">
        <TierLadder
          tiers={round.tiers}
          buyAlonePriceSen={round.buyAlonePriceSen}
          currentTier={round.progress.currentTier}
          unitName={round.unitName}
        />
        <ProgressBar progress={round.progress} tiers={round.tiers} unitName={round.unitName} />
      </section>

      <section aria-labelledby="my-lines" className="flex flex-col gap-3">
        <h2 id="my-lines" className="text-xl font-semibold">
          Your orders in this round
        </h2>
        {round.myParticipations.length === 0 ? (
          <EmptyState
            title="You haven't joined this round"
            explanation="When your shop joins, each order shows here with its quantity, price and status."
            example="6 cartons, RM 164.09 each, paid RM 984.54. Waiting for cut-off."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {round.myParticipations.map((p) => (
              <li key={p.id} className="bg-card flex flex-col gap-1 rounded-2xl border p-4">
                <p className="text-lg font-semibold tabular-nums">
                  {formatUnits(p.quantity, round.unitName)}
                </p>
                <p className="text-base">
                  <Money sen={p.startingAllInSen} /> each, paid <Money sen={p.paidSen} />
                </p>
                <p className="text-base">
                  {p.priceLimitSen !== null ? (
                    <>
                      Price limit <Money sen={p.priceLimitSen} />
                    </>
                  ) : (
                    'No price limit'
                  )}
                </p>
                <p className="text-base">
                  {p.destinationType === 'door' ? 'Delivery to your door' : 'Pickup point'} ·{' '}
                  {formatMytDate(p.deliveryDate)}
                </p>
                <p className="text-muted-foreground text-base">Status: {statusWords(p.status)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && settings ? (
        <JoinSheet
          roundId={round.roundId}
          productName={round.name}
          unitName={round.unitName}
          settings={settings}
        />
      ) : null}
    </div>
  );
}
