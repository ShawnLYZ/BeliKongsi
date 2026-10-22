import type { ApprovalRequest } from '@/generated/prisma/client';
import { mytDate } from '@/lib/time';
import { appendLog } from '@/server/modules/activity/log';
import type { DecisionInput } from '@/server/modules/approvals/approvals';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { cancelRoundWithRefunds } from '@/server/modules/rounds/cancel';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { badRequest, conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { withTransaction, type TxContext } from '@/server/platform/tx';

/** Locks the order's round, then loads the order. */
async function lockedOrder(ctx: TxContext, supplierOrderId: string) {
  const { tx } = ctx;
  const found = await tx.supplierOrder.findUnique({
    where: { id: supplierOrderId },
    select: { roundId: true },
  });
  if (!found) throw notFound('Supplier order');
  await tx.$queryRaw`SELECT id FROM rounds WHERE id = ${found.roundId}::uuid FOR UPDATE`;
  return tx.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderId } });
}

function requireAwaitingSupplier(status: string): void {
  if (status !== 'awaiting_supplier') {
    throw conflict('ORDER_NOT_AWAITING_SUPPLIER', 'This order is no longer waiting for you.');
  }
}

/** The supplier confirms the order and says when it will be dispatched (PRD 12, story 105). */
export async function confirmSupplierOrder(
  ctx: TxContext,
  request: ApprovalRequest,
  input: DecisionInput,
): Promise<void> {
  const { tx, now } = ctx;
  const date = input.expectedDispatchDate?.trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw badRequest('Please say when you will dispatch this order (YYYY-MM-DD).');
  }
  if (date < mytDate(now)) {
    throw badRequest('The dispatch date cannot be in the past.');
  }
  const order = await lockedOrder(ctx, request.subjectId);
  requireAwaitingSupplier(order.status);

  await tx.supplierOrder.update({
    where: { id: order.id },
    data: { status: 'confirmed', confirmedAt: now, expectedDispatchDate: date },
  });
  await tx.round.update({ where: { id: order.roundId }, data: { status: 'confirmed' } });
  await appendLog(ctx, {
    action: 'supplier_order.confirmed',
    subjectType: 'supplier_order',
    subjectId: order.id,
    scope: { supplierId: order.supplierId, operator: true },
    before: { status: 'awaiting_supplier' },
    after: { status: 'confirmed', roundId: order.roundId, expectedDispatchDate: date },
  });
  await emitEvent(ctx, 'supplier_order.confirmed', {
    supplierOrderId: order.id,
    roundId: order.roundId,
    supplierId: order.supplierId,
    expectedDispatchDate: date,
  });
}

/** The supplier turns the order down: the round is cancelled with full refunds and Ops are told. */
export async function rejectSupplierOrderBySupplier(
  ctx: TxContext,
  request: ApprovalRequest,
  input: DecisionInput,
): Promise<void> {
  const { tx } = ctx;
  const reason = input.reason?.trim() ?? '';
  const order = await lockedOrder(ctx, request.subjectId);
  requireAwaitingSupplier(order.status);

  await tx.supplierOrder.update({
    where: { id: order.id },
    data: { status: 'rejected_by_supplier', rejectionReason: reason },
  });
  await cancelRoundWithRefunds(ctx, order.roundId, { by: 'supplier', reason });
  await appendLog(ctx, {
    action: 'supplier_order.rejected_by_supplier',
    subjectType: 'supplier_order',
    subjectId: order.id,
    scope: { supplierId: order.supplierId, operator: true },
    before: { status: 'awaiting_supplier' },
    after: { status: 'rejected_by_supplier', roundId: order.roundId },
    reason,
  });
  await emitEvent(ctx, 'supplier_order.rejected', {
    supplierOrderId: order.id,
    roundId: order.roundId,
    supplierId: order.supplierId,
  });
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: order.supplierId } });
  const round = await tx.round.findUniqueOrThrow({
    where: { id: order.roundId },
    include: { product: true },
  });
  await notify(ctx, {
    type: 'ops.supplier_rejected',
    audience: { operator: true, roles: ['ops'] },
    link: `/ops/rounds/${order.roundId}`,
    message: TEMPLATES['ops.supplier_rejected']({
      supplierName: supplier.name,
      shortName: round.product.shortName,
      reason,
    }),
    dedupeKey: `ops.supplier_rejected:${order.id}`,
  });
}

/** The supplier says the confirmed order has left for the hub (story 107). */
export async function markDispatched(
  deps: AppDeps,
  caller: Caller,
  supplierOrderId: string,
): Promise<{ supplierOrderId: string; status: 'dispatched' }> {
  if (caller.kind !== 'person' || caller.session.membership.role !== 'supplier') {
    throw notFound('Supplier order');
  }
  const ownSupplierId = caller.session.membership.supplierId;
  return withTransaction(deps, caller, async (ctx) => {
    if (!UUID.test(supplierOrderId)) throw notFound('Supplier order');
    const order = await lockedOrder(ctx, supplierOrderId);
    if (order.supplierId !== ownSupplierId) throw notFound('Supplier order');
    if (order.status !== 'confirmed') {
      throw conflict('ORDER_NOT_CONFIRMED', 'Only a confirmed order can be marked dispatched.');
    }
    await ctx.tx.supplierOrder.update({
      where: { id: order.id },
      data: { status: 'dispatched', dispatchedAt: ctx.now },
    });
    await ctx.tx.round.update({ where: { id: order.roundId }, data: { status: 'dispatched' } });
    await appendLog(ctx, {
      action: 'supplier_order.dispatched',
      subjectType: 'supplier_order',
      subjectId: order.id,
      scope: { supplierId: order.supplierId, operator: true },
      before: { status: 'confirmed' },
      after: { status: 'dispatched', roundId: order.roundId },
    });
    await emitEvent(ctx, 'supplier_order.dispatched', {
      supplierOrderId: order.id,
      roundId: order.roundId,
      supplierId: order.supplierId,
    });
    return { supplierOrderId: order.id, status: 'dispatched' as const };
  });
}
