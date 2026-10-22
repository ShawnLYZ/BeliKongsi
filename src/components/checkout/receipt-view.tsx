import type { PaymentMethodView, ReceiptView as Receipt } from '@/lib/views/payments';
import { Money } from '@/components/common/money';
import { formatMyt, formatRM } from '@/lib/format';

export const METHOD_LABELS: Record<PaymentMethodView, string> = {
  duitnow_qr: 'DuitNow QR',
  fpx: 'FPX online banking',
  balance_only: 'BeliKongsi balance',
};

/** A succeeded payment's receipt (PRD §8): every line, any delivery fee, balance used and paid. */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <article aria-labelledby="receipt-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="receipt-title" className="text-2xl font-bold">
            Receipt
          </h1>
          <span className="bg-accent text-accent-foreground rounded-full px-3 py-0.5 text-base font-semibold">
            Simulated
          </span>
        </div>
        <p className="text-base">{receipt.shopName}</p>
        <p className="text-muted-foreground text-base">
          Paid <time dateTime={receipt.issuedAt}>{formatMyt(new Date(receipt.issuedAt))}</time>
        </p>
      </div>

      <section aria-labelledby="receipt-lines" className="flex flex-col gap-2">
        <h2 id="receipt-lines" className="text-lg font-semibold">
          Your goods
        </h2>
        <ul className="bg-card flex flex-col divide-y rounded-2xl border">
          {receipt.lines.map((line, i) => (
            <li key={`${line.productName}-${i}`} className="flex flex-col gap-1 p-4">
              <p className="text-base font-semibold">{line.productName}</p>
              <p className="text-base tabular-nums">
                {line.quantity} × {formatRM(line.unitAllInSen)} = {formatRM(line.lineSen)}
              </p>
              <p className="text-muted-foreground text-base tabular-nums">
                Each: {formatRM(line.unitGoodsSen)} goods + {formatRM(line.unitFeeSen)} BeliKongsi
                fee + {formatRM(line.unitShippingSen)} shipping share
              </p>
            </li>
          ))}
        </ul>
      </section>

      <dl className="bg-card grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 rounded-2xl border p-4 text-base">
        {receipt.deliveryFeeSen > 0 ? (
          <>
            <dt>Delivery fee</dt>
            <dd className="text-right">
              <Money sen={receipt.deliveryFeeSen} />
            </dd>
          </>
        ) : null}
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">
          <Money sen={receipt.totalSen} />
        </dd>
        <dt>BeliKongsi balance used</dt>
        <dd className="text-right">
          <Money sen={receipt.balanceAppliedSen} />
        </dd>
        <dt className="text-lg font-bold">Paid ({METHOD_LABELS[receipt.method]}, Simulated)</dt>
        <dd className="text-right text-lg font-bold">
          <Money sen={receipt.paidSen} />
        </dd>
      </dl>

      {receipt.partnerReference ? (
        <p className="text-base">
          Reference <span className="font-mono tabular-nums">{receipt.partnerReference}</span>
        </p>
      ) : null}
      <p className="text-muted-foreground text-base">{receipt.notice}</p>
    </article>
  );
}
