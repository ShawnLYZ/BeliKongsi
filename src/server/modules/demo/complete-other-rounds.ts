import type { ApprovalRequest, ApprovalType } from '@/generated/prisma/client';
import { mytDate } from '@/lib/time';
import { appendLog, withLogReason } from '@/server/modules/activity/log';
import {
  featuredConsignmentIds,
  updateConsignmentStatus,
} from '@/server/modules/fulfilment/consignments';
import { recordHubCheck } from '@/server/modules/supplier-orders/hub-check';
import { approveSupplierOrder } from '@/server/modules/supplier-orders/ops-decision';
import {
  confirmSupplierOrder,
  dispatchOrder,
} from '@/server/modules/supplier-orders/supplier-decision';
import { systemCaller, type Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict } from '@/server/platform/errors';
import { type TxContext, withTransaction } from '@/server/platform/tx';
import { getDemoState, requireDemoMode } from './demo';

const REASON = 'Demo simulation';

/**
 * Demo "Complete other rounds" (PRD §9, story 165). For every round of a product other than the
 * featured one that has not reached the hub (`formed`, `ordered`, `confirmed` or `dispatched`),
 * the system continues from its supplier order's status: the Ops approval, the supplier's
 * confirmation (dispatch on the required date, or today once that has passed), the dispatch and a
 * hub check with every accepted unit good, one transaction per step. Then every `planned` consignment without featured goods is dispatched and
 * arrives (pickup point) or goes out for delivery (door). Every step is logged by the system with
 * the reason "Demo simulation". A run with nothing to do changes nothing.
 *
 * "Featured" means any round of `DemoSettings.featuredProductId`, not `featuredRoundId`: after the
 * cut-off that points at next week's open round, while the formed week is the one being followed.
 * The signed-in presenter only asks; every step is the system's.
 */
export async function completeOtherRounds(
  deps: AppDeps,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the steps run as the system
  presenter: Caller,
): Promise<{ rounds: number; consignmentsMoved: number }> {
  await requireDemoMode(deps);
  const caller = systemCaller(REASON);
  return withLogReason(REASON, async () => {
    const { featuredProductId } = await getDemoState(deps);
    const unfinished = await deps.prisma.round.findMany({
      where: {
        status: { in: ['formed', 'ordered', 'confirmed', 'dispatched'] },
        ...(featuredProductId ? { productId: { not: featuredProductId } } : {}),
      },
      orderBy: [{ cutoffAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    let rounds = 0;
    for (const { id: roundId } of unfinished) {
      const order = await deps.prisma.supplierOrder.findUnique({ where: { roundId } });
      if (!order) continue;
      // Continue from wherever the order stands: someone may have approved, confirmed or
      // dispatched it already, or an earlier run stopped part-way.
      let status = order.status;
      if (status === 'awaiting_ops') {
        await withTransaction(deps, caller, (ctx) =>
          approveAs(ctx, 'supplier_order', order.id, (request) =>
            approveSupplierOrder(ctx, request, { decision: 'approve' }),
          ),
        );
        status = 'awaiting_supplier';
      }
      if (status === 'awaiting_supplier') {
        await withTransaction(deps, caller, (ctx) =>
          approveAs(ctx, 'supplier_confirmation', order.id, (request) =>
            confirmSupplierOrder(ctx, request, {
              decision: 'approve',
              // The required date, unless the clock has passed it (a past date is refused).
              expectedDispatchDate: latestDate(order.requiredDispatchDate, mytDate(ctx.now)),
            }),
          ),
        );
        status = 'confirmed';
      }
      if (status === 'confirmed') {
        await withTransaction(deps, caller, (ctx) => dispatchOrder(ctx, order.id));
        status = 'dispatched';
      }
      if (status !== 'dispatched') continue;
      await recordHubCheck(deps, caller, order.id, {
        goodUnits: order.acceptedQuantity,
        damagedUnits: 0,
      });
      rounds += 1;
    }

    const planned = await deps.prisma.consignment.findMany({
      where: { status: 'planned' },
      orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, destinationType: true },
    });
    const featured = await featuredConsignmentIds(
      deps,
      planned.map((c) => c.id),
    );
    let consignmentsMoved = 0;
    for (const c of planned) {
      if (featured.has(c.id)) continue;
      await updateConsignmentStatus(deps, caller, c.id, 'dispatched');
      const next = c.destinationType === 'door' ? 'out_for_delivery' : 'arrived';
      await updateConsignmentStatus(deps, caller, c.id, next);
      consignmentsMoved += 1;
    }

    if (rounds > 0 || consignmentsMoved > 0) {
      await withTransaction(deps, caller, (ctx) =>
        appendLog(ctx, {
          action: 'demo.complete_other_rounds',
          subjectType: 'demo',
          subjectId: 'demo',
          scope: { operator: true },
          after: { rounds, consignmentsMoved },
        }),
      );
    }
    return { rounds, consignmentsMoved };
  });
}

/**
 * Locks the order's pending approval of the type, runs its approve handler and marks it approved
 * by no one (the system). Someone deciding it first is 409, as in the inbox.
 */
async function approveAs(
  ctx: TxContext,
  type: ApprovalType,
  supplierOrderId: string,
  approve: (request: ApprovalRequest) => Promise<void>,
): Promise<void> {
  const { tx } = ctx;
  const found = await tx.approvalRequest.findFirst({
    where: { type, subjectId: supplierOrderId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!found) throw conflict('NO_APPROVAL', `The ${type} approval is missing.`);
  await tx.$queryRaw`SELECT id FROM approval_requests WHERE id = ${found.id}::uuid FOR UPDATE`;
  const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: found.id } });
  if (request.status !== 'pending') {
    throw conflict('ALREADY_DECIDED', 'This request has already been decided.');
  }
  await approve(request);
  await tx.approvalRequest.update({
    where: { id: request.id },
    data: { status: 'approved', decidedByUserId: null, decidedAt: ctx.now, reason: null },
  });
}

/** The later of two `YYYY-MM-DD` dates. */
function latestDate(a: string, b: string): string {
  return a >= b ? a : b;
}
