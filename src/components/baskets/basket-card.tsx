import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { OwnerBasketView } from '@/lib/views/baskets';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { Countdown } from '@/components/rounds/countdown';
import { ApprovePayButton } from './approve-pay-button';
import { staffChange } from './basket-line';
import { BASKET_STATUS_TEXT } from './basket-screen';

/** Owner home: this week's basket at a glance, with "Approve & pay" (PRD §22 "Home"). */
export function BasketCard({ basket, serverNow }: { basket: OwnerBasketView; serverNow: string }) {
  const { totals } = basket;
  const items = basket.lines.filter((l) => !l.removed).length;
  const changes = basket.lines.filter((l) => staffChange(l) !== null).length;
  const open = basket.status === 'draft' || basket.status === 'payment_pending';
  return (
    <section
      aria-labelledby="basket-card"
      className="border-card-top bg-card flex flex-col gap-3 rounded-2xl border border-t-8 p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="basket-card" className="text-lg font-semibold">
          This week&apos;s basket
        </h2>
        <p className="text-base">
          {items === 1 ? '1 item' : `${items} items`} ·{' '}
          <span className="font-semibold">{BASKET_STATUS_TEXT[basket.status]}</span>
        </p>
        {changes > 0 ? (
          <p className="text-base">
            Your staff changed {changes === 1 ? '1 line' : `${changes} lines`}.
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-base">
        {open ? (
          <>
            <dt>Amount now</dt>
            <dd className="text-right text-lg font-bold">
              <Money sen={totals.payNowSen} />
            </dd>
          </>
        ) : null}
        <dt>Estimated after cut-off</dt>
        <dd className="text-right">
          about <Money sen={totals.estimatedAfterCutoffSen} />
        </dd>
        <dt>Estimated savings</dt>
        <dd className="text-primary text-right font-semibold">
          <Money sen={totals.estimatedSavingsSen} />
        </dd>
      </dl>
      {open ? (
        <Countdown
          cutoffAt={basket.deadlineAt}
          serverNow={serverNow}
          label="Approve by"
          passedText="The deadline has passed"
        />
      ) : null}
      {basket.status === 'draft' ? <ApprovePayButton basketId={basket.basketId} /> : null}
      {basket.status === 'payment_pending' ? (
        <ApprovePayButton basketId={basket.basketId} label="Continue to payment" />
      ) : null}
      {basket.status === 'paid' && basket.paymentId ? (
        <Link href={`/owner/receipts/${basket.paymentId}`} className={BUTTON_SECONDARY}>
          See receipt
        </Link>
      ) : null}
      <Link href="/owner/basket" className={BUTTON_SECONDARY}>
        Open basket
        <ChevronRight aria-hidden="true" className="size-5" />
      </Link>
    </section>
  );
}
