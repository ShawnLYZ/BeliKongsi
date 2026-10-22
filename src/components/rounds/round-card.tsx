import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { OpenRoundView } from '@/lib/views/rounds';
import { ProductImage } from '@/components/catalogue/product-image';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { Countdown } from './countdown';
import { ProgressBar } from './progress-bar';
import { CLOSING_TEXT, isClosing } from './status-words';
import { TierLadder } from './tier-ladder';

/**
 * This shop's all-in price per unit: what it pays now (the starting price) and, estimated, what the
 * round is heading to at its current tier. All-in is goods, shipping share and fee.
 */
export function MyPriceBox({ myPrice }: { myPrice: OpenRoundView['myPrice'] }) {
  if (!myPrice) {
    return (
      <p className="bg-muted rounded-xl p-3 text-base">
        Choose a pickup point in Settings to see your all-in price.
      </p>
    );
  }
  const lower =
    myPrice.projectedAllInSen !== null && myPrice.projectedAllInSen < myPrice.startingAllInSen
      ? myPrice.projectedAllInSen
      : null;
  return (
    <div className="bg-primary/10 flex flex-col gap-1 rounded-xl p-3">
      <p className="text-base font-medium">Your all-in price ({myPrice.destinationLabel})</p>
      <p className="text-2xl font-bold">
        <Money sen={myPrice.startingAllInSen} /> now
      </p>
      {lower !== null ? (
        <p className="text-base">
          Estimated <Money sen={lower} className="font-semibold" /> after cut-off, at today&apos;s
          tier. You get the difference back.
        </p>
      ) : null}
      <p className="text-muted-foreground text-base">
        All-in means the goods, your shipping share of <Money sen={myPrice.unitShippingSen} /> and
        the BeliKongsi fee. You never pay more than the price now.
      </p>
    </div>
  );
}

/**
 * One open round on the open-rounds page (PRD §22). Past its cut-off (by the app's clock) and not
 * yet closed by the close job, it says "Closing…" (R11).
 */
export function RoundCard({
  round,
  supplierName,
  category,
  serverNow,
}: {
  round: OpenRoundView;
  supplierName: string | null;
  category: string;
  serverNow: string;
}) {
  const closing = isClosing(round.cutoffAt, serverNow);
  return (
    <article
      aria-labelledby={`round-${round.roundId}`}
      className="bg-card flex flex-col gap-4 rounded-2xl border p-4"
    >
      <div className="flex gap-3">
        <ProductImage
          product={{
            name: round.name,
            category,
            imageUrl: round.imageUrl,
            imageAiGenerated: round.imageAiGenerated,
          }}
          className="w-28 shrink-0 self-start"
        />
        <div className="flex flex-col gap-1">
          <h2 id={`round-${round.roundId}`} className="text-lg leading-snug font-semibold">
            {round.name}
          </h2>
          {closing ? (
            <p className="bg-accent text-accent-foreground w-fit rounded-full px-2 text-base font-semibold">
              {CLOSING_TEXT}
            </p>
          ) : null}
          <p className="text-base">{round.packDescription}</p>
          {supplierName ? (
            <p className="text-muted-foreground text-base">From {supplierName}</p>
          ) : null}
        </div>
      </div>
      <TierLadder
        tiers={round.tiers}
        buyAlonePriceSen={round.buyAlonePriceSen}
        currentTier={round.progress.currentTier}
        unitName={round.unitName}
      />
      <ProgressBar progress={round.progress} tiers={round.tiers} unitName={round.unitName} />
      <Countdown cutoffAt={round.cutoffAt} serverNow={serverNow} passedText={CLOSING_TEXT} />
      <MyPriceBox myPrice={round.myPrice} />
      <Link href={`/owner/rounds/${round.roundId}`} className={BUTTON_SECONDARY}>
        See details<span className="sr-only"> of {round.name}</span>
        <ChevronRight aria-hidden="true" className="size-5" />
      </Link>
    </article>
  );
}
