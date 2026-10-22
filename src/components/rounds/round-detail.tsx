import Link from 'next/link';
import type { ShopSettingsView } from '@/lib/views/directory';
import type { RoundDetailView } from '@/lib/views/rounds';
import { ProductImage } from '@/components/catalogue/product-image';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { Money } from '@/components/common/money';
import { formatMytDate, formatRM, formatUnits } from '@/lib/format';
import { Countdown } from './countdown';
import { JoinSheet } from './join-sheet';
import { ProgressBar } from './progress-bar';
import { CLOSING_TEXT, isClosing, statusWords } from './status-words';
import { TierLadder } from './tier-ladder';

/**
 * A closed round's result, then when the product's next round closes, for an owner who missed
 * this one (story 50).
 */
function RoundOutcome({ round }: { round: RoundDetailView }) {
  const { result } = round;
  const minimum = round.tiers[0]?.minQuantity;
  return (
    <div className="flex flex-col gap-3">
      {result ? (
        <p className="bg-primary/10 rounded-xl p-3 text-base font-medium tabular-nums">
          Closed at {formatRM(result.finalUnitPriceSen)} a {round.unitName} (tier {result.finalTier}
          ): {formatUnits(result.totalKept, round.unitName)} from {result.shopCount}{' '}
          {result.shopCount === 1 ? 'shop' : 'shops'}.
        </p>
      ) : round.status === 'failed' && minimum !== undefined ? (
        <p className="bg-muted rounded-xl p-3 text-base">
          This round didn&apos;t reach its minimum of {formatUnits(minimum, round.unitName)}. Every
          shop got a full refund.
        </p>
      ) : null}
      {round.nextRoundCutoffAt && round.nextRoundId ? (
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold">
            Next round closes{' '}
            <time dateTime={round.nextRoundCutoffAt}>
              {formatMytDate(new Date(round.nextRoundCutoffAt))}
            </time>
          </p>
          <Link href={`/owner/rounds/${round.nextRoundId}`} className={BUTTON_SECONDARY}>
            See the next round
          </Link>
        </div>
      ) : null}
    </div>
  );
}

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
  const closing = open && isClosing(round.cutoffAt, serverNow);
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
          Round status:{' '}
          <span className="font-semibold">
            {closing ? CLOSING_TEXT : statusWords(round.status)}
          </span>
        </p>
        {open ? (
          <>
            <Countdown cutoffAt={round.cutoffAt} serverNow={serverNow} passedText={CLOSING_TEXT} />
            <p className="text-base">
              Goods ready from{' '}
              <time dateTime={round.expectedReadyAt}>
                {formatMytDate(new Date(round.expectedReadyAt))}
              </time>
              .
            </p>
          </>
        ) : (
          <RoundOutcome round={round} />
        )}
      </div>

      <section className="bg-card flex flex-col gap-4 rounded-2xl border p-4">
        <TierLadder
          tiers={round.tiers}
          buyAlonePriceSen={round.buyAlonePriceSen}
          currentTier={open ? round.progress.currentTier : (round.result?.finalTier ?? null)}
          unitName={round.unitName}
          currentLabel={open ? 'Now' : 'Final'}
        />
        {open ? (
          <ProgressBar progress={round.progress} tiers={round.tiers} unitName={round.unitName} />
        ) : null}
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

      {open && !closing && settings ? (
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
