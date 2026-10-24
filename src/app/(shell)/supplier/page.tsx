import { EmptyState } from '@/components/common/empty-state';
import { OrderCard } from '@/components/supplier/order-card';
import { mytDate } from '@/lib/time';
import { resolveClock } from '@/server/adapters/clock';
import { listSupplierOrders } from '@/server/modules/supplier-orders/portal';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireSupplierPage } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** The supplier's orders: one consolidated quantity per Kongsi round, never a shop (PRD §15). */
export default async function SupplierOrdersPage() {
  const { session, supplierId } = requireSupplierPage(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const [orders, clock] = await Promise.all([
    listSupplierOrders(deps, personCaller(session), supplierId),
    resolveClock(deps),
  ]);
  const today = mytDate(clock.now());
  const waiting = orders.filter(
    (o) => o.status === 'awaiting_supplier' || o.status === 'confirmed',
  );
  const others = orders.filter((o) => !waiting.includes(o));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold">Orders</h1>
        <p className="mt-1 text-base">{session.membership.orgName}</p>
      </div>
      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          explanation="When a Kongsi round forms and BeliKongsi approves it, the order appears here for you to confirm with a dispatch date or reject with a reason."
          example="New BeliKongsi order: 105 cartons of condensed milk for the Klang Valley hub."
        />
      ) : (
        <>
          <section aria-labelledby="todo-title" className="flex flex-col gap-3">
            <h2 id="todo-title" className="text-lg font-semibold">
              Needs you <span className="tabular-nums">({waiting.length})</span>
            </h2>
            {waiting.length === 0 ? (
              <p className="text-muted-foreground text-base">Nothing to confirm or dispatch.</p>
            ) : (
              waiting.map((o) => (
                <OrderCard key={o.supplierOrderId} order={o} today={today} linkToDetail />
              ))
            )}
          </section>
          {others.length > 0 ? (
            <section aria-labelledby="other-title" className="flex flex-col gap-3">
              <h2 id="other-title" className="text-lg font-semibold">
                Other orders
              </h2>
              {others.map((o) => (
                <OrderCard key={o.supplierOrderId} order={o} today={today} linkToDetail />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
