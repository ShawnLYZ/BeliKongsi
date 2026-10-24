import Link from 'next/link';
import type { SupplierOrderView, SupplierPayoutView } from '@/lib/views/supplier';
import { Money } from '@/components/common/money';
import { SimulatedBadge } from '@/components/common/simulated-badge';
import { formatMyt, formatMytDate, formatUnits } from '@/lib/format';
import { HubCheckForm } from './hub-check-form';
import { NewDateForm } from './new-date-form';
import { LINK, orderStatusLabel } from './labels';

/** Ops view of one supplier order, with the hub check once it is dispatched. */
export function SupplierOrderDetail({
  order,
  supplierName,
  shopCount,
  payout,
}: {
  order: SupplierOrderView;
  supplierName: string;
  shopCount: number;
  payout: SupplierPayoutView | undefined;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-muted-foreground text-base font-semibold">
          Supplier order · {supplierName} · {order.hubName}
        </p>
        <h1 className="text-2xl font-bold">{order.productName}</h1>
        <p className="mt-1 text-base font-semibold">{orderStatusLabel(order.status)}</p>
        <p className="mt-1 text-base">
          <Link href={`/ops/rounds/${order.roundId}`} className={LINK}>
            See the round and every shop in it
          </Link>
        </p>
      </div>

      <dl className="bg-card grid gap-4 rounded-2xl border p-4 text-base sm:grid-cols-3 xl:grid-cols-6">
        <div>
          <dt className="text-muted-foreground font-semibold">Quantity</dt>
          <dd className="tabular-nums">{formatUnits(order.quantity, order.unitName)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-semibold">Unit price</dt>
          <dd>
            <Money sen={order.unitPriceSen} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-semibold">Order total</dt>
          <dd>
            <Money sen={order.totalSen} className="font-semibold" />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-semibold">Shops</dt>
          <dd className="tabular-nums">{shopCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-semibold">Dispatch by</dt>
          <dd>{formatMytDate(order.requiredDispatchDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground font-semibold">Supplier&apos;s dispatch date</dt>
          <dd>{order.expectedDispatchDate ? formatMytDate(order.expectedDispatchDate) : '—'}</dd>
        </div>
      </dl>

      {order.status === 'confirmed' || order.status === 'dispatched' ? (
        <section aria-labelledby="late-title" className="flex max-w-xl flex-col gap-3">
          <h2 id="late-title" className="text-xl font-bold">
            Late delivery
          </h2>
          <p className="text-base">
            If these goods will not be ready on time, set the new date. Every shop in the order is
            told.
          </p>
          <NewDateForm endpoint={`/api/supplier-orders/${order.supplierOrderId}/delay`} />
        </section>
      ) : null}

      <section aria-labelledby="hub-title" className="flex flex-col gap-3">
        <h2 id="hub-title" className="text-xl font-bold">
          Hub check
        </h2>
        {payout ? (
          <div className="bg-primary/10 rounded-2xl p-4 text-base">
            <p className="text-lg font-semibold">
              Checked at the hub: {formatUnits(payout.goodUnits, order.unitName)} good
            </p>
            <p className="tabular-nums">
              Payout released: <Money sen={payout.amountSen} className="font-semibold" />{' '}
              <SimulatedBadge />
            </p>
            <p className="tabular-nums">Payout reference: {payout.reference}</p>
            <p>
              <time dateTime={payout.paidAt}>{formatMyt(new Date(payout.paidAt))}</time>
            </p>
          </div>
        ) : order.status === 'dispatched' ? (
          <>
            <p className="text-base">
              Count what arrived at the hub. Shops are served in the order they joined; anyone short
              is refunded for the missing units. The supplier is paid for good units only.
            </p>
            <HubCheckForm
              supplierOrderId={order.supplierOrderId}
              orderedQuantity={order.quantity}
              unitName={order.unitName}
            />
          </>
        ) : (
          <p className="text-base">
            The hub check opens once the supplier marks this order dispatched.
          </p>
        )}
      </section>
    </div>
  );
}
