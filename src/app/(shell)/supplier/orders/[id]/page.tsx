import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BUTTON_QUIET } from '@/components/common/controls';
import { OrderCard } from '@/components/supplier/order-card';
import { mytDate } from '@/lib/time';
import { resolveClock } from '@/server/adapters/clock';
import { listSupplierOrders } from '@/server/modules/supplier-orders/portal';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireSupplierPage } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function SupplierOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, supplierId } = requireSupplierPage(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { id } = await params;
  const [orders, clock] = await Promise.all([
    listSupplierOrders(deps, personCaller(session), supplierId),
    resolveClock(deps),
  ]);
  // Only this supplier's own orders are listed, so another supplier's id is simply not found.
  const order = orders.find((o) => o.supplierOrderId === id);
  if (!order) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/supplier" className={`${BUTTON_QUIET} self-start px-0`}>
        ← All orders
      </Link>
      <h1 className="text-2xl font-bold">Order</h1>
      <OrderCard order={order} today={mytDate(clock.now())} linkToDetail={false} />
      <p className="text-muted-foreground text-base">
        BeliKongsi has already collected payment from its shops for this order. You are paid for the
        good units checked at the hub (Simulated).
      </p>
    </div>
  );
}
