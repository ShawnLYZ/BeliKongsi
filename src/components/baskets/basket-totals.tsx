import type { BasketTotalsView } from '@/lib/views/baskets';
import { Money } from '@/components/common/money';

/** The basket's totals block (PRD §22): what is paid now, and what it is estimated to cost. */
export function BasketTotals({
  totals,
  door,
  payable,
}: {
  totals: BasketTotalsView;
  /** Door delivery: the delivery fee row is always shown, even when it is zero. */
  door: boolean;
  /** Still to be paid (draft or waiting for payment). Otherwise "Pay now" and balance are hidden. */
  payable: boolean;
}) {
  return (
    <section
      aria-labelledby="basket-totals"
      className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
    >
      <h2 id="basket-totals" className="text-lg font-semibold">
        Totals
      </h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-base">
        <dt>Items at the starting price</dt>
        <dd className="text-right">
          <Money sen={totals.itemsAtStartingSen} />
        </dd>
        <dt className="text-muted-foreground pl-3">BeliKongsi fee included</dt>
        <dd className="text-muted-foreground text-right">
          <Money sen={totals.feeIncludedSen} />
        </dd>
        {door || totals.deliveryFeeSen > 0 ? (
          <>
            <dt>Delivery fee</dt>
            <dd className="text-right">
              <Money sen={totals.deliveryFeeSen} />
            </dd>
          </>
        ) : null}
        {payable && totals.balanceAppliedSen > 0 ? (
          <>
            <dt>BeliKongsi balance used</dt>
            <dd className="text-right">
              −<Money sen={totals.balanceAppliedSen} />
            </dd>
          </>
        ) : null}
        {payable ? (
          <>
            <dt className="border-t pt-2 text-lg font-bold">Pay now</dt>
            <dd className="border-t pt-2 text-right text-lg font-bold">
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
      <p className="text-muted-foreground text-base">
        {payable ? 'You pay the starting price now.' : 'You paid the starting price.'} If the final
        price is lower, the difference comes back to your BeliKongsi balance after cut-off.
        {totals.savingsHasBuyAloneBasis
          ? ' Savings on items without a usual price are compared with buying alone.'
          : ''}
      </p>
    </section>
  );
}
