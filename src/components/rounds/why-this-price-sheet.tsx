'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { BUTTON_QUIET } from '@/components/common/controls';

/**
 * "Why this price?" (PRD §22): the quote's plain-English sentences for one line, then the note on
 * the delivery fee, which is charged per delivery and never split across lines.
 */
export function WhyThisPriceSheet({
  productName,
  explanation,
  deliveryFeeNote,
}: {
  productName: string;
  explanation: string[];
  deliveryFeeNote: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`${BUTTON_QUIET} -ml-2 self-start px-2`}
        onClick={() => setOpen(true)}
      >
        <HelpCircle aria-hidden="true" className="size-5" />
        Why this price?<span className="sr-only"> {productName}</span>
      </button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Why this price?"
        description={productName}
      >
        <ul className="flex flex-col gap-3">
          {explanation.map((sentence) => (
            <li key={sentence} className="bg-muted rounded-xl p-3 text-base tabular-nums">
              {sentence}
            </li>
          ))}
        </ul>
        <p className="text-base">{deliveryFeeNote}</p>
        <p className="text-muted-foreground text-base">
          Prices after cut-off are Estimated: they depend on how many units every shop orders by
          then.
        </p>
      </BottomSheet>
    </>
  );
}
