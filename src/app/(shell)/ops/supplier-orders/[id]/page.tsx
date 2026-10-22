import { notFound } from 'next/navigation';
import { SupplierOrderDetail } from '@/components/ops/supplier-order-detail';
import { opsRoundDetail, opsRoundsBoard } from '@/server/modules/ops/rounds-board';
import { listSupplierOrders, listSupplierPayouts } from '@/server/modules/supplier-orders/portal';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OpsSupplierOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = requirePageRole(await getPageSession(), ['ops']);
  const deps = getDeps();
  scheduleDueWork(deps);
  const caller = personCaller(session);
  const { id } = await params;

  const board = await opsRoundsBoard(deps, caller, {});
  const card = board.columns.flatMap((c) => c.rounds).find((r) => r.supplierOrderId === id);
  if (!card) notFound();
  const [orders, payouts, detail] = await Promise.all([
    listSupplierOrders(deps, caller, card.supplierId),
    listSupplierPayouts(deps, caller, card.supplierId),
    opsRoundDetail(deps, caller, card.roundId),
  ]);
  const order = orders.find((o) => o.supplierOrderId === id);
  if (!order) notFound();
  const payout = payouts.find((p) => p.supplierOrderId === id);
  const keptShops = new Set(
    detail.participants.filter((p) => p.status === 'kept').map((p) => p.shopId),
  ).size;

  return (
    <SupplierOrderDetail
      order={order}
      supplierName={card.supplierName}
      shopCount={keptShops || detail.round.shopCount}
      payout={payout}
    />
  );
}
