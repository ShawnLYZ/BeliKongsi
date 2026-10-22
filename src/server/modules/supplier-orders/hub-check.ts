import type { Participation } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import { allocateShortfall, type AllocateShortfallResult } from '@/server/engine';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { lockShop } from '@/server/modules/payments/fee';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireOps } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';

export type HubCheckInput = { goodUnits: number; damagedUnits: number; notes?: string };

export type HubCheckPreview = {
  orderedQuantity: number;
  receivedCounted: number;
  excessUnits: number;
  excessFlag: boolean;
  allocations: {
    participationId: string;
    shopName: string;
    joinedAt: string;
    quantity: number;
    allocated: number;
    missing: number;
    refundSen: number;
  }[];
  supplierPayableSen: number;
  feeRevenueSen: number;
  logisticsPayableSen: number;
  shortfallRefundSen: number;
};

export type HubCheckView = {
  supplierOrderId: string;
  status: 'settled';
  goodUnits: number;
  damagedUnits: number;
  receivedCounted: number;
  shortfallUnits: number;
  excessUnits: number;
  payoutSen: number;
  payoutReference: string;
};

/** Runs the engine over the round's kept lines (first come, first served). */
function allocate(
  kept: Participation[],
  goodUnits: number,
  finalGoodsPriceSen: number,
): AllocateShortfallResult {
  return allocateShortfall({
    kept: kept.map((p) => ({
      id: p.id,
      quantity: p.quantity,
      joinedAt: p.joinedAt.toISOString(),
      final: {
        goodsSen: p.finalGoodsSen ?? 0,
        feeSen: p.finalFeeSen ?? 0,
        shippingSen: p.unitShippingSen,
        allInSen: p.finalAllInSen ?? 0,
      },
    })),
    goodUnitsReceived: goodUnits,
    finalGoodsPriceSen,
  });
}

/** Ops previews what a hub check would do. Nothing is written. */
export async function previewHubCheck(
  deps: AppDeps,
  caller: Caller,
  supplierOrderId: string,
  input: HubCheckInput,
): Promise<HubCheckPreview> {
  requireOps(caller);
  if (!UUID.test(supplierOrderId)) throw notFound('Supplier order');
  const order = await deps.prisma.supplierOrder.findUnique({ where: { id: supplierOrderId } });
  if (!order) throw notFound('Supplier order');
  if (order.status !== 'dispatched') {
    throw conflict('ORDER_NOT_DISPATCHED', 'Only a dispatched order can be checked at the hub.');
  }
  const round = await deps.prisma.round.findUniqueOrThrow({ where: { id: order.roundId } });
  const kept = await deps.prisma.participation.findMany({
    where: { roundId: round.id, status: 'kept' },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const result = allocate(kept, input.goodUnits, round.finalUnitPriceSen ?? 0);
  const shops = await deps.prisma.shop.findMany({
    where: { id: { in: [...new Set(kept.map((p) => p.shopId))] } },
    select: { id: true, name: true },
  });
  const byId = new Map(kept.map((p) => [p.id, p]));
  const shopName = new Map(shops.map((s) => [s.id, s.name]));
  return {
    orderedQuantity: result.orderedQuantity,
    receivedCounted: result.receivedCounted,
    excessUnits: result.excessUnits,
    excessFlag: result.excessFlag,
    allocations: result.allocations.map((a) => {
      const p = byId.get(a.id)!;
      return {
        participationId: a.id,
        shopName: shopName.get(p.shopId) ?? '',
        joinedAt: p.joinedAt.toISOString(),
        quantity: p.quantity,
        allocated: a.allocated,
        missing: a.missing,
        refundSen: a.refundSen,
      };
    }),
    supplierPayableSen: result.supplierPayableSen,
    feeRevenueSen: result.feeRevenueSen,
    logisticsPayableSen: result.logisticsPayableSen,
    shortfallRefundSen: result.shortfallRefundSen,
  };
}

/**
 * Ops records the hub check (PRD 6.7, 8): allocations, shortfall refunds, settlement postings and
 * the simulated supplier payout, all in one transaction. A second check gets 409.
 */
export async function recordHubCheck(
  deps: AppDeps,
  caller: Caller,
  supplierOrderId: string,
  input: HubCheckInput,
): Promise<HubCheckView> {
  requireOps(caller);
  if (!UUID.test(supplierOrderId)) throw notFound('Supplier order');
  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    const found = await tx.supplierOrder.findUnique({
      where: { id: supplierOrderId },
      select: { roundId: true },
    });
    if (!found) throw notFound('Supplier order');
    const roundId = found.roundId;

    // Lock order: round, kept lines, shops in id order, then the ledger.
    await tx.$queryRaw`SELECT id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`;
    const order = await tx.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderId } });
    if (order.status !== 'dispatched') {
      throw conflict('ORDER_NOT_DISPATCHED', 'Only a dispatched order can be checked at the hub.');
    }
    const round = await tx.round.findUniqueOrThrow({
      where: { id: roundId },
      include: { product: true },
    });
    const lockedParts = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM participations WHERE round_id = ${roundId}::uuid AND status = 'kept'
      ORDER BY id FOR UPDATE`;
    const kept = await tx.participation.findMany({
      where: { id: { in: lockedParts.map((r) => r.id) } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
    const shopIds = [...new Set(kept.map((p) => p.shopId))].sort();
    for (const shopId of shopIds) await lockShop(ctx, shopId);

    const result = allocate(kept, input.goodUnits, round.finalUnitPriceSen ?? 0);
    const byId = new Map(kept.map((p) => [p.id, p]));
    const { unitName, shortName } = round.product;

    // Allocations and shortfall refunds out of the round hold.
    const missingByShop = new Map<string, { units: number; refundSen: number }>();
    for (const a of result.allocations) {
      const p = byId.get(a.id)!;
      await tx.allocation.create({
        data: { participationId: p.id, allocated: a.allocated, missing: a.missing },
      });
      await tx.participation.update({
        where: { id: p.id },
        data: { status: a.allocated === 0 ? 'shorted' : 'allocated', updatedAt: now },
      });
      if (a.refundSen > 0) {
        await post(ctx, {
          from: { kind: 'round_hold', roundId },
          to: { kind: 'shop_balance', shopId: p.shopId },
          amountSen: a.refundSen,
          kind: 'refund_shortfall',
          refs: { roundId, participationId: p.id, paymentId: p.paymentId, shopId: p.shopId },
        });
        const t = missingByShop.get(p.shopId) ?? { units: 0, refundSen: 0 };
        t.units += a.missing;
        t.refundSen += a.refundSen;
        missingByShop.set(p.shopId, t);
      }
    }

    // Settlement for the good units (zero amounts are never posted).
    const supplierRefs = { roundId, supplierOrderId: order.id, supplierId: order.supplierId };
    if (result.supplierPayableSen > 0) {
      await post(ctx, {
        from: { kind: 'round_hold', roundId },
        to: { kind: 'supplier_payable', supplierId: order.supplierId },
        amountSen: result.supplierPayableSen,
        kind: 'settlement_supplier',
        refs: supplierRefs,
      });
    }
    if (result.feeRevenueSen > 0) {
      await post(ctx, {
        from: { kind: 'round_hold', roundId },
        to: { kind: 'fee_revenue' },
        amountSen: result.feeRevenueSen,
        kind: 'settlement_fee',
        refs: { roundId, supplierOrderId: order.id },
      });
    }
    if (result.logisticsPayableSen > 0) {
      await post(ctx, {
        from: { kind: 'round_hold', roundId },
        to: { kind: 'logistics_payable' },
        amountSen: result.logisticsPayableSen,
        kind: 'settlement_logistics',
        refs: { roundId, supplierOrderId: order.id },
      });
    }

    // The simulated payout: called even for 0 so the hub check has a reference.
    const payout = await deps.payments.payout({
      supplierOrderId: order.id,
      supplierId: order.supplierId,
      amountSen: result.supplierPayableSen,
    });
    if (result.supplierPayableSen > 0) {
      await post(ctx, {
        from: { kind: 'supplier_payable', supplierId: order.supplierId },
        to: { kind: 'partner_cash' },
        amountSen: result.supplierPayableSen,
        kind: 'supplier_payout',
        refs: supplierRefs,
        memo: payout.reference,
      });
    }

    const shortfallUnits = result.orderedQuantity - result.receivedCounted;
    const hubCheck = await tx.hubCheck.create({
      data: {
        supplierOrderId: order.id,
        goodUnits: input.goodUnits,
        damagedUnits: input.damagedUnits,
        notes: input.notes?.trim() || null,
        checkedByUserId: ctx.actor.type === 'person' ? ctx.actor.userId : null,
        checkedAt: now,
        receivedCounted: result.receivedCounted,
        shortfallUnits,
        excessUnits: result.excessUnits,
        payoutSen: result.supplierPayableSen,
        payoutReference: payout.reference,
      },
    });
    await tx.supplierOrder.update({ where: { id: order.id }, data: { status: 'settled' } });
    await tx.round.update({ where: { id: roundId }, data: { status: 'at_hub' } });

    // M7 extension point: planConsignmentsAndPickups(ctx, roundId) goes here, once the
    // fulfilment module exists, so consignments and pickups are planned in this transaction.

    await appendLog(ctx, {
      action: 'hub.check_recorded',
      subjectType: 'supplier_order',
      subjectId: order.id,
      scope: { supplierId: order.supplierId, operator: true },
      before: { status: 'dispatched' },
      after: {
        status: 'settled',
        roundId,
        goodUnits: input.goodUnits,
        damagedUnits: input.damagedUnits,
        receivedCounted: result.receivedCounted,
        excessUnits: result.excessUnits,
      },
    });
    if (shortfallUnits > 0) {
      await appendLog(ctx, {
        action: 'hub.shortfall_allocated',
        subjectType: 'supplier_order',
        subjectId: order.id,
        scope: { supplierId: order.supplierId, operator: true },
        after: {
          roundId,
          shortfallUnits,
          shortfallRefundSen: result.shortfallRefundSen,
        },
      });
    }
    await appendLog(ctx, {
      action: 'hub.supplier_payout_released',
      subjectType: 'supplier_order',
      subjectId: order.id,
      scope: { supplierId: order.supplierId, operator: true },
      after: { amountSen: result.supplierPayableSen, reference: payout.reference, simulated: true },
    });
    await emitEvent(ctx, 'hub_check.recorded', {
      supplierOrderId: order.id,
      goodUnits: input.goodUnits,
      damagedUnits: input.damagedUnits,
      shortfall: shortfallUnits,
    });
    await emitEvent(ctx, 'supplier_payout.released', {
      supplierId: order.supplierId,
      supplierOrderId: order.id,
      amountSen: result.supplierPayableSen,
    });

    // One refund record and one owner notice per shop that was short.
    const owners = await tx.shop.findMany({
      where: { id: { in: shopIds }, isBackground: false },
      select: { id: true },
    });
    const ownerShopIds = new Set(owners.map((s) => s.id));
    for (const shopId of shopIds) {
      const t = missingByShop.get(shopId);
      if (!t) continue;
      await appendLog(ctx, {
        action: 'refund.issued',
        subjectType: 'shop',
        subjectId: shopId,
        scope: { shopId },
        after: { amountSen: t.refundSen, kind: 'shortfall', roundId },
      });
      await emitEvent(ctx, 'refund.issued', {
        shopId,
        amountSen: t.refundSen,
        kind: 'shortfall',
        referenceId: roundId,
      });
      if (!ownerShopIds.has(shopId)) continue;
      await notify(ctx, {
        type: 'owner.shortfall',
        audience: { shopId, roles: ['owner'] },
        link: '/owner/kongsi',
        message: TEMPLATES['owner.shortfall']({
          missingUnits: t.units,
          unitName,
          shortName,
          refundSen: t.refundSen,
        }),
        dedupeKey: `owner.shortfall:${roundId}:${shopId}`,
      });
    }

    if (result.supplierPayableSen > 0) {
      await notify(ctx, {
        type: 'supplier.payout',
        audience: { supplierId: order.supplierId, roles: ['supplier'] },
        link: '/supplier',
        message: TEMPLATES['supplier.payout']({
          amountSen: result.supplierPayableSen,
          units: result.receivedCounted,
          unitName,
        }),
        dedupeKey: `supplier.payout:${order.id}`,
      });
    }

    return {
      supplierOrderId: order.id,
      status: 'settled' as const,
      goodUnits: hubCheck.goodUnits,
      damagedUnits: hubCheck.damagedUnits,
      receivedCounted: hubCheck.receivedCounted,
      shortfallUnits: hubCheck.shortfallUnits,
      excessUnits: hubCheck.excessUnits,
      payoutSen: hubCheck.payoutSen,
      payoutReference: hubCheck.payoutReference,
    };
  });
}
