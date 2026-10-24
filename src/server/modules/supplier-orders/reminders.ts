import type { ApprovalType } from '@/generated/prisma/client';
import { mytDate } from '@/lib/time';
import { resolveClock } from '@/server/adapters/clock';
import { approvalLink } from '@/server/modules/approvals/links';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { expectedHubDate } from '@/server/modules/rounds/schedule';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction, type TxContext } from '@/server/platform/tx';

const OVERDUE_AFTER_MS = 12 * 60 * 60 * 1000;
/** The approvals Ops decide. A weekly basket is paid for by the owner, never from the inbox. */
const OPS_APPROVALS: ApprovalType[] = ['supplier_order', 'claim', 'data_deletion'];

const toOps = { operator: true, roles: ['ops' as const] };

async function lockApproval(ctx: TxContext, id: string): Promise<void> {
  await ctx.tx.$queryRaw`SELECT id FROM approval_requests WHERE id = ${id}::uuid FOR UPDATE`;
}

async function lockOrder(ctx: TxContext, id: string): Promise<void> {
  await ctx.tx.$queryRaw`SELECT id FROM supplier_orders WHERE id = ${id}::uuid FOR UPDATE`;
}

/** Runs one subject in its own transaction, so a failure never holds up the others. */
async function each(
  deps: AppDeps,
  what: string,
  ids: string[],
  work: (ctx: TxContext, id: string) => Promise<number>,
): Promise<number> {
  let sent = 0;
  for (const id of ids) {
    try {
      sent += await withTransaction(deps, systemCaller('operational reminders'), (ctx) =>
        work(ctx, id),
      );
    } catch (error) {
      console.error(
        `Reminder for ${what} ${id} failed:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return sent;
}

/** A supplier confirmation pending 12 hours reminds the supplier and tells Ops (stories 116, 134). */
async function chaseConfirmations(deps: AppDeps, now: Date): Promise<number> {
  const rows = await deps.prisma.approvalRequest.findMany({
    where: {
      type: 'supplier_confirmation',
      status: 'pending',
      createdAt: { lte: new Date(now.getTime() - OVERDUE_AFTER_MS) },
    },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return each(
    deps,
    'supplier confirmation',
    rows.map((r) => r.id),
    async (ctx, id) => {
      const { tx } = ctx;
      await lockApproval(ctx, id);
      const approval = await tx.approvalRequest.findUniqueOrThrow({ where: { id } });
      if (
        approval.status !== 'pending' ||
        ctx.now.getTime() - approval.createdAt.getTime() < OVERDUE_AFTER_MS
      ) {
        return 0;
      }
      const order = await tx.supplierOrder.findUniqueOrThrow({
        where: { id: approval.subjectId },
        include: { supplier: { select: { name: true } }, round: { include: { product: true } } },
      });
      const { shortName } = order.round.product;
      const { unitName } = order.round;
      let sent = await notify(ctx, {
        type: 'supplier.confirm_reminder',
        audience: { supplierId: order.supplierId, roles: ['supplier'] },
        link: approvalLink('supplier_confirmation', order.id, approval.id),
        message: TEMPLATES['supplier.confirm_reminder']({
          quantity: order.quantity,
          unitName,
          shortName,
        }),
        dedupeKey: `supplier-reminder:supplier_confirmation:${id}`,
      });
      sent += await notify(ctx, {
        type: 'ops.supplier_unconfirmed',
        audience: toOps,
        link: `/ops/rounds/${order.roundId}`,
        message: TEMPLATES['ops.supplier_unconfirmed']({
          supplierName: order.supplier.name,
          shortName,
        }),
        dedupeKey: `ops-reminder:supplier_confirmation:${id}`,
      });
      return sent;
    },
  );
}

/**
 * An Ops approval pending 12 hours is marked overdue, once, and every Ops user is reminded. The
 * overdue time is set in the same transaction as the notices and never overwritten.
 */
async function chaseOpsApprovals(deps: AppDeps, now: Date): Promise<number> {
  const rows = await deps.prisma.approvalRequest.findMany({
    where: {
      type: { in: OPS_APPROVALS },
      assigneeRole: 'ops',
      status: 'pending',
      overdueAt: null,
      createdAt: { lte: new Date(now.getTime() - OVERDUE_AFTER_MS) },
    },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return each(
    deps,
    'Ops approval',
    rows.map((r) => r.id),
    async (ctx, id) => {
      const { tx } = ctx;
      await lockApproval(ctx, id);
      const approval = await tx.approvalRequest.findUniqueOrThrow({ where: { id } });
      if (
        approval.status !== 'pending' ||
        approval.overdueAt ||
        ctx.now.getTime() - approval.createdAt.getTime() < OVERDUE_AFTER_MS
      ) {
        return 0;
      }
      await tx.approvalRequest.update({ where: { id }, data: { overdueAt: ctx.now } });
      return notify(ctx, {
        type: 'ops.approval_overdue',
        audience: toOps,
        link: approvalLink(approval.type, approval.subjectId, id),
        message: TEMPLATES['ops.approval_overdue']({ summary: approval.summary }),
        dedupeKey: `ops-reminder:${approval.type}:${id}`,
      });
    },
  );
}

/** Confirmed, not dispatched by the end of the required dispatch date (MYT): Ops are alerted. */
async function chaseDispatches(deps: AppDeps, now: Date): Promise<number> {
  const rows = await deps.prisma.supplierOrder.findMany({
    where: { status: 'confirmed', dispatchedAt: null, requiredDispatchDate: { lt: mytDate(now) } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return each(
    deps,
    'dispatch',
    rows.map((r) => r.id),
    async (ctx, id) => {
      const { tx } = ctx;
      await lockOrder(ctx, id);
      const order = await tx.supplierOrder.findUniqueOrThrow({
        where: { id },
        include: { supplier: { select: { name: true } }, round: { include: { product: true } } },
      });
      if (
        order.status !== 'confirmed' ||
        order.dispatchedAt ||
        order.requiredDispatchDate >= mytDate(ctx.now)
      ) {
        return 0;
      }
      const { shortName } = order.round.product;
      const { unitName } = order.round;
      return notify(ctx, {
        type: 'ops.not_dispatched',
        audience: toOps,
        link: `/ops/rounds/${order.roundId}`,
        message: TEMPLATES['ops.not_dispatched']({
          quantity: order.quantity,
          unitName,
          shortName,
          supplierName: order.supplier.name,
          dueDate: order.requiredDispatchDate,
        }),
        dedupeKey: `ops-reminder:not_dispatched:${id}`,
      });
    },
  );
}

/** Dispatched, no hub check by the end of the expected hub date (MYT): Ops are alerted. */
async function chaseHubChecks(deps: AppDeps, now: Date): Promise<number> {
  const rows = await deps.prisma.supplierOrder.findMany({
    where: { status: 'dispatched', hubCheck: { is: null } },
    select: { id: true, round: { select: { cutoffAt: true } } },
    orderBy: { id: 'asc' },
  });
  const today = mytDate(now);
  return each(
    deps,
    'hub check',
    rows.filter((r) => expectedHubDate(r.round.cutoffAt) < today).map((r) => r.id),
    async (ctx, id) => {
      const { tx } = ctx;
      await lockOrder(ctx, id);
      const order = await tx.supplierOrder.findUniqueOrThrow({
        where: { id },
        include: {
          hubCheck: { select: { id: true } },
          supplier: { select: { name: true } },
          round: { include: { product: true } },
        },
      });
      const expected = expectedHubDate(order.round.cutoffAt);
      if (order.status !== 'dispatched' || order.hubCheck || expected >= mytDate(ctx.now)) {
        return 0;
      }
      return notify(ctx, {
        type: 'ops.hub_check_overdue',
        audience: toOps,
        link: `/ops/rounds/${order.roundId}`,
        message: TEMPLATES['ops.hub_check_overdue']({
          shortName: order.round.product.shortName,
          supplierName: order.supplier.name,
          expectedDate: expected,
        }),
        dedupeKey: `ops-reminder:hub_check_overdue:${id}`,
      });
    },
  );
}

/**
 * Chases work before rounds stall (P1-11): supplier confirmations pending 12 hours, Ops approvals
 * pending 12 hours (marked overdue), orders not dispatched by the end of their required dispatch
 * date and dispatched orders with no hub check by the end of their expected hub date. Every notice
 * has a dedupe key per subject and kind, so the job can run every few minutes. Returns how many
 * notices it sent.
 */
export async function sendOperationalReminders(deps: AppDeps): Promise<{ sent: number }> {
  const now = (await resolveClock(deps)).now();
  let sent = 0;
  sent += await chaseConfirmations(deps, now);
  sent += await chaseOpsApprovals(deps, now);
  sent += await chaseDispatches(deps, now);
  sent += await chaseHubChecks(deps, now);
  return { sent };
}
