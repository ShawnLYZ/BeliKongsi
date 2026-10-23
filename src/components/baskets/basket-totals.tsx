import type { BasketSettledView, BasketTotalsView } from '@/lib/views/baskets';
import { Money } from '@/components/common/money';

/** The basket's totals block (PRD §22): what is paid now, and what it is estimated to cost. */
export function BasketTotals({
  totals,
  door,
  payable,
  settled = null,
}: {
  totals: BasketTotalsView;
  /** Once every round has closed, what was paid and what it came to (the open totals are zero). */
  settled?: BasketSettledView | null;
  /** Door delivery: the delivery fee row is always shown, even when it is zero. */
  door: boolean;
  /** Still to be paid (draft or waiting for payment). Otherwise "Pay now" and balance are hidden. */
  payable: boolean;
}) {
  if (settled) {
    return (
      <section
        aria-labelledby="basket-totals"
        className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
      >
        <h2 id="basket-totals" className="text-lg font-semibold">
          Totals
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-base">
          <dt>Goods paid</dt>
          <dd className="text-right">
            <Money sen={settled.paidSen} />
          </dd>
          <dt className="text-lg font-bold">Final price</dt>
          <dd className="text-right text-lg font-bold">
            <Money sen={settled.finalSen} />
          </dd>
          <dt>Back in your balance</dt>
          <dd className="text-right">
            <Money sen={settled.refundedSen} />
          </dd>
          <dt>{settled.savingsStatus === 'verified' ? 'Verified savings' : 'Estimated savings'}</dt>
          <dd className="text-primary text-right font-semibold">
            <Money
              sen={settled.estimatedSavingsSen}
              className={settled.estimatedSavingsSen < 0 ? 'text-destructive' : undefined}
            />
          </dd>
        </dl>
        <p className="text-muted-foreground text-base">
          The rounds have closed.{' '}
          {settled.savingsStatus === 'verified'
            ? 'Your goods are checked, so these savings are verified.'
            : 'Savings are verified after your goods are checked.'}
          {settled.savingsHasBuyAloneBasis
            ? ' Savings on items without a usual price are compared with buying alone.'
            : ''}
        </p>
      </section>
    );
  }
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
          <Money
            sen={totals.estimatedSavingsSen}
            className={totals.estimatedSavingsSen < 0 ? 'text-destructive' : undefined}
          />
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
