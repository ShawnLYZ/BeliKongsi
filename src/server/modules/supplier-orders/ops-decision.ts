import type { ApprovalRequest } from '@/generated/prisma/client';
import { formatRM, formatUnits } from '@/lib/format';
import { appendLog } from '@/server/modules/activity/log';
import { createApproval, type DecisionInput } from '@/server/modules/approvals/approvals';
import { approvalLink } from '@/server/modules/approvals/links';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { cancelRoundWithRefunds } from '@/server/modules/rounds/cancel';
import { conflict } from '@/server/platform/errors';
import type { TxContext } from '@/server/platform/tx';

/** Locks the order's round, then loads the order; refuses one that is not waiting for Ops. */
async function lockedOrderForOps(ctx: TxContext, supplierOrderId: string) {
  const { tx } = ctx;
  const { roundId } = await tx.supplierOrder.findUniqueOrThrow({
    where: { id: supplierOrderId },
    select: { roundId: true },
  });
  await tx.$queryRaw`SELECT id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`;
  const order = await tx.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderId } });
  if (order.status !== 'awaiting_ops') {
    throw conflict('ORDER_NOT_AWAITING_OPS', 'This order is no longer waiting for Ops.');
  }
  return order;
}

/** Ops approves a supplier order: it goes to the supplier to confirm (PRD 12, story 119). */
export async function approveSupplierOrder(
  ctx: TxContext,
  request: ApprovalRequest,
  input: DecisionInput,
): Promise<void> {
  const { tx } = ctx;
  const order = await lockedOrderForOps(ctx, request.subjectId);
  const round = await tx.round.findUniqueOrThrow({
    where: { id: order.roundId },
    include: { product: true },
  });
  const hub = await tx.hub.findUniqueOrThrow({ where: { id: order.hubId } });
  const { shortName } = round.product;
  const { unitName } = round;
  const hubLabel = `${hub.region} hub`;

  const confirmation = await createApproval(ctx, {
    type: 'supplier_confirmation',
    subjectType: 'supplier_order',
    subjectId: order.id,
    supplierId: order.supplierId,
    assigneeRole: 'supplier',
    amountSen: order.totalSen,
    summary: `New order: ${formatUnits(order.quantity, unitName)} of ${shortName}, ${formatRM(order.totalSen)}`,
    whyNeeded: 'Please confirm you can supply this order, and say when you will dispatch it.',
    evidence: {
      productName: round.product.name,
      quantity: order.quantity,
      unitPriceSen: order.unitPriceSen,
      orderCostSen: order.totalSen,
      hubLabel,
      requiredDispatchDate: order.requiredDispatchDate,
    },
  });
  await tx.supplierOrder.update({
    where: { id: order.id },
    data: { status: 'awaiting_supplier', supplierApprovalId: confirmation.id },
  });
  await tx.round.update({ where: { id: round.id }, data: { status: 'ordered' } });

  await appendLog(ctx, {
    action: 'supplier_order.approved',
    subjectType: 'supplier_order',
    subjectId: order.id,
    scope: { supplierId: order.supplierId, operator: true },
    before: { status: 'awaiting_ops' },
    after: { status: 'awaiting_supplier', roundId: round.id, approvalId: confirmation.id },
    reason: input.note?.trim() || undefined,
  });
  await emitEvent(ctx, 'supplier_order.approved', {
    supplierOrderId: order.id,
    roundId: round.id,
    supplierId: order.supplierId,
    quantity: order.quantity,
    totalSen: order.totalSen,
  });
  await notify(ctx, {
    type: 'supplier.new_order',
    audience: { supplierId: order.supplierId, roles: ['supplier'] },
    link: approvalLink('supplier_confirmation', order.id, confirmation.id),
    message: TEMPLATES['supplier.new_order']({
      quantity: order.quantity,
      unitName,
      shortName,
      hubLabel,
    }),
    dedupeKey: `supplier.new_order:${order.id}`,
  });
}

/** Ops rejects a supplier order: the round is cancelled and every shop is refunded in full. */
export async function rejectSupplierOrder(
  ctx: TxContext,
  request: ApprovalRequest,
  input: DecisionInput,
): Promise<void> {
  const reason = input.reason?.trim() ?? '';
  const order = await lockedOrderForOps(ctx, request.subjectId);
  await ctx.tx.supplierOrder.update({
    where: { id: order.id },
    data: { status: 'rejected_by_ops', rejectionReason: reason },
  });
  await cancelRoundWithRefunds(ctx, order.roundId, { by: 'ops', reason });
  await appendLog(ctx, {
    action: 'supplier_order.rejected_by_ops',
    subjectType: 'supplier_order',
    subjectId: order.id,
    scope: { supplierId: order.supplierId, operator: true },
    before: { status: 'awaiting_ops' },
    after: { status: 'rejected_by_ops', roundId: order.roundId },
    reason,
  });
}
