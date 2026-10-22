import Link from 'next/link';
import type { ShopSettingsView } from '@/lib/views/directory';
import type { OwnerBasketView } from '@/lib/views/baskets';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { Countdown } from '@/components/rounds/countdown';
import { formatRM } from '@/lib/format';
import { ApprovePayButton } from './approve-pay-button';
import { BasketLine, staffChange } from './basket-line';
import { BasketTotals } from './basket-totals';
import { FulfilmentSwitch } from './fulfilment-switch';
import { SkipWeekButton } from './skip-week-button';

export const BASKET_STATUS_TEXT: Record<OwnerBasketView['status'], string> = {
  draft: 'Waiting for your approval',
  payment_pending: 'Waiting for your payment',
  paid: 'Approved and paid',
  skipped: 'Skipped this week. Nothing was charged.',
  expired: 'The deadline passed before it was paid. Nothing was charged.',
};

/** The sentence under "Why this price?" about the one delivery fee per date (PRD §6.9). */
export function deliveryFeeNote(basket: OwnerBasketView): string {
  if (basket.fulfilment === 'pickup') {
    return `No delivery fee: you collect from ${basket.pickupPoint?.name ?? 'your pickup point'}. Door delivery would add one fee per delivery date, never split across lines.`;
  }
  return basket.totals.deliveryFeeSen > 0
    ? `Door delivery adds one delivery fee of ${formatRM(basket.totals.deliveryFeeSen)} to this basket. It is charged once per delivery date, not split across lines, so it is not in this price.`
    : 'Your door delivery fee for this date is already paid, so this basket adds none. It is never split across lines.';
}

/** The owner's weekly basket (PRD §22 "Weekly basket"). */
export function BasketScreen({
  basket,
  settings,
  serverNow,
}: {
  basket: OwnerBasketView;
  settings: ShopSettingsView;
  serverNow: string;
}) {
  const draft = basket.status === 'draft';
  const note = deliveryFeeNote(basket);
  const changes = basket.lines.filter((l) => staffChange(l) !== null).length;
  const active = basket.lines.filter((l) => !l.removed);
  const removed = basket.lines.filter((l) => l.removed);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">This week&apos;s basket</h1>
        <p className="text-base">
          Status: <span className="font-semibold">{BASKET_STATUS_TEXT[basket.status]}</span>
        </p>
        {draft || basket.status === 'payment_pending' ? (
          <Countdown
            cutoffAt={basket.deadlineAt}
            serverNow={serverNow}
            label="Approve by"
            passedText="The deadline has passed"
          />
        ) : null}
        {changes > 0 ? (
          <p className="border-accent bg-accent/10 rounded-xl border-2 p-3 text-base">
            Your staff changed {changes === 1 ? '1 line' : `${changes} lines`}. They are highlighted
            below.
          </p>
        ) : null}
      </div>

      <section aria-labelledby="basket-lines" className="flex flex-col gap-3">
        <h2 id="basket-lines" className="text-xl font-semibold">
          {active.length === 1 ? '1 item' : `${active.length} items`}
        </h2>
        <ul className="flex flex-col gap-3">
          {[...active, ...removed].map((line) => (
            <li key={line.lineId}>
              <BasketLine line={line} deliveryFeeNote={note} />
            </li>
          ))}
        </ul>
      </section>

      <FulfilmentSwitch
        basketId={basket.basketId}
        fulfilment={basket.fulfilment}
        pickupPoint={basket.pickupPoint}
        settings={settings}
        editable={draft}
      />

      <BasketTotals
        totals={basket.totals}
        door={basket.fulfilment === 'door'}
        payable={draft || basket.status === 'payment_pending'}
      />

      {draft ? (
        <div className="flex flex-col gap-3">
          <ApprovePayButton basketId={basket.basketId} />
          <SkipWeekButton basketId={basket.basketId} />
        </div>
      ) : basket.status === 'payment_pending' ? (
        <ApprovePayButton basketId={basket.basketId} label="Continue to payment" />
      ) : basket.status === 'paid' && basket.paymentId ? (
        <Link href={`/owner/receipts/${basket.paymentId}`} className={BUTTON_SECONDARY}>
          See receipt
        </Link>
      ) : null}
    </div>
  );
}
