import type { Product, Round } from '@/generated/prisma/client';
import { formatRM, formatUnits } from '@/lib/format';
import type { CloseRoundResult } from '@/server/engine';
import { appendLog } from '@/server/modules/activity/log';
import { createApproval } from '@/server/modules/approvals/approvals';
import { approvalLink } from '@/server/modules/approvals/links';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { requiredDispatchDate } from '@/server/modules/rounds/schedule';
import type { TxContext } from '@/server/platform/tx';

/**
 * Drafts the consolidated supplier order of a formed round and the Ops approval that commits the
 * pooled money (PRD 6.7). Runs inside the close transaction, after the cut-off refunds, so the
 * round hold holds exactly what the kept lines paid. Ops sees whether it adds up.
 */
export async function draftSupplierOrder(
  ctx: TxContext,
  round: Round & { product: Product },
  result: CloseRoundResult,
): Promise<{ supplierOrderId: string; approvalId: string }> {
  const { tx, now } = ctx;
  const quantity = result.totalKept;
  const unitPriceSen = result.finalUnitPriceSen!;
  const totalSen = quantity * unitPriceSen;

  const kept = await tx.participation.findMany({
    where: { roundId: round.id, status: 'kept' },
    select: { shopId: true, quantity: true, finalFeeSen: true, unitShippingSen: true },
  });
  const feesSen = kept.reduce((sum, p) => sum + (p.finalFeeSen ?? 0) * p.quantity, 0);
  const shippingSen = kept.reduce((sum, p) => sum + p.unitShippingSen * p.quantity, 0);
  const shopCount = new Set(kept.map((p) => p.shopId)).size;
  const moneyHeldSen = await balanceOf(tx, { kind: 'round_hold', roundId: round.id });
  const expected = totalSen + feesSen + shippingSen;
  const passed = moneyHeldSen === expected;

  const supplier = await tx.supplier.findUniqueOrThrow({
    where: { id: round.supplierId },
    select: { name: true },
  });
  const order = await tx.supplierOrder.create({
    data: {
      roundId: round.id,
      supplierId: round.supplierId,
      hubId: round.hubId,
      quantity,
      acceptedQuantity: quantity,
      unitPriceSen,
      totalSen,
      status: 'awaiting_ops',
      requiredDispatchDate: requiredDispatchDate(round.cutoffAt),
      createdAt: now,
    },
    select: { id: true },
  });

  const { shortName } = round.product;
  const { unitName } = round;
  const approval = await createApproval(ctx, {
    type: 'supplier_order',
    subjectType: 'supplier_order',
    subjectId: order.id,
    supplierId: round.supplierId,
    assigneeRole: 'ops',
    amountSen: totalSen,
    summary: `Supplier order: ${formatUnits(quantity, unitName)} of ${shortName}, ${formatRM(totalSen)}`,
    whyNeeded: 'Pooled money is committed only after an Ops approval.',
    evidence: {
      productName: round.product.name,
      supplierName: supplier.name,
      finalTier: result.finalTier,
      quantity,
      shopCount,
      moneyHeldSen,
      orderCostSen: totalSen,
      feesSen,
      shippingSen,
      moneyCheck: {
        passed,
        detail: passed
          ? `Held ${formatRM(moneyHeldSen)} = order ${formatRM(totalSen)} + fees ${formatRM(feesSen)} + shipping ${formatRM(shippingSen)}.`
          : `Held ${formatRM(moneyHeldSen)} but order, fees and shipping come to ${formatRM(expected)}.`,
      },
      roundLink: `/ops/rounds/${round.id}`,
    },
  });
  await tx.supplierOrder.update({ where: { id: order.id }, data: { opsApprovalId: approval.id } });

  await appendLog(ctx, {
    action: 'supplier_order.drafted',
    subjectType: 'supplier_order',
    subjectId: order.id,
    scope: { supplierId: round.supplierId, operator: true },
    after: { roundId: round.id, quantity, unitPriceSen, totalSen, approvalId: approval.id },
  });
  await notify(ctx, {
    type: 'ops.approval_needed',
    audience: { operator: true, roles: ['ops'] },
    link: approvalLink('supplier_order', order.id, approval.id),
    message: TEMPLATES['ops.approval_needed']({ shortName, totalSen }),
    dedupeKey: `ops.approval_needed:${approval.id}`,
  });
  return { supplierOrderId: order.id, approvalId: approval.id };
}
