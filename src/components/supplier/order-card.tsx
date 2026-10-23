import Link from 'next/link';
import type { SupplierOrderView } from '@/lib/views/supplier';
import { Money } from '@/components/common/money';
import { formatMytDate, formatUnits } from '@/lib/format';
import { OrderActions } from './order-actions';

const STATUS: Record<string, string> = {
  awaiting_ops: 'Being checked by BeliKongsi',
  awaiting_supplier: 'Waiting for you to confirm',
  confirmed: 'Confirmed by you',
  dispatched: 'Dispatched',
  settled: 'Checked at the hub and paid (Simulated)',
  rejected_by_ops: 'Cancelled by BeliKongsi',
  rejected_by_supplier: 'Rejected by you',
};

export function supplierOrderStatus(status: string): string {
  return STATUS[status] ?? status.replace(/_/g, ' ');
}

/** One consolidated order as the supplier sees it: one quantity for one hub, never a shop. */
export function OrderCard({
  order,
  today,
  linkToDetail,
}: {
  order: SupplierOrderView;
  today: string;
  linkToDetail: boolean;
}) {
  const waiting = order.status === 'awaiting_supplier';
  return (
    <article
      className={
        waiting
          ? 'border-t-card-top bg-card flex flex-col gap-3 rounded-2xl border border-t-4 p-4'
          : 'bg-card flex flex-col gap-3 rounded-2xl border p-4'
      }
    >
      <div>
        <p className="text-muted-foreground text-base font-semibold">
          {supplierOrderStatus(order.status)}
        </p>
        <h2 className="text-lg font-semibold">
          {linkToDetail ? (
            <Link
              href={`/supplier/orders/${order.supplierOrderId}`}
              className="focus-visible:ring-ring/60 inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-3"
            >
              {formatUnits(order.quantity, order.unitName)} of {order.productName}
            </Link>
          ) : (
            <>
              {formatUnits(order.quantity, order.unitName)} of {order.productName}
            </>
          )}
        </h2>
        <p className="text-muted-foreground text-base">{order.packDescription}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-base">
        <div>
          <dt className="text-muted-foreground">Deliver to</dt>
          <dd>{order.hubName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Unit price</dt>
          <dd>
            <Money sen={order.unitPriceSen} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Order total</dt>
          <dd>
            <Money sen={order.totalSen} className="font-semibold" />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {order.expectedDispatchDate ? 'Your dispatch date' : 'Dispatch by'}
          </dt>
          <dd>{formatMytDate(order.expectedDispatchDate ?? order.requiredDispatchDate)}</dd>
        </div>
      </dl>
      <OrderActions order={order} today={today} />
    </article>
  );
}
