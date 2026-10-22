import type {
  ActorType,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalType,
  Prisma,
  Role,
} from '@/generated/prisma/client';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, forbidden, notFound, unprocessable } from '@/server/platform/errors';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { skipDraftBasket } from '../baskets/lifecycle';

type Json = Prisma.InputJsonValue;

export type DecisionInput = {
  decision: 'approve' | 'reject';
  reason?: string;
  note?: string;
  expectedDispatchDate?: string;
};

export type ApprovalHandler = {
  onApprove(ctx: TxContext, request: ApprovalRequest, input: DecisionInput): Promise<void>;
  onReject(ctx: TxContext, request: ApprovalRequest, input: DecisionInput): Promise<void>;
};

export type ApprovalView = {
  id: string;
  type: ApprovalType;
  subjectType: string;
  subjectId: string;
  summary: string;
  whyNeeded: string;
  amountSen: number | null;
  evidence: Prisma.JsonValue;
  proposedBy: { type: ActorType; name: string | null };
  status: ApprovalStatus;
  createdAt: string;
  link: string;
};

const handlers = new Map<ApprovalType, ApprovalHandler>();

export function registerApprovalHandler(type: ApprovalType, h: ApprovalHandler): void {
  handlers.set(type, h);
}

export async function createApproval(
  ctx: TxContext,
  input: {
    type: ApprovalType;
    subjectType: string;
    subjectId: string;
    shopId?: string;
    supplierId?: string;
    assigneeRole: Role;
    amountSen?: number;
    summary: string;
    whyNeeded: string;
    evidence: Json;
    expiresAt?: Date;
  },
): Promise<{ id: string }> {
  const { actor } = ctx;
  return ctx.tx.approvalRequest.create({
    data: {
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      shopId: input.shopId ?? null,
      supplierId: input.supplierId ?? null,
      assigneeRole: input.assigneeRole,
      amountSen: input.amountSen ?? null,
      summary: input.summary,
      whyNeeded: input.whyNeeded,
      evidence: input.evidence,
      proposedByType: actor.type,
      proposedByUserId: actor.type === 'person' ? actor.userId : null,
      status: 'pending',
      expiresAt: input.expiresAt ?? null,
      createdAt: ctx.now,
    },
    select: { id: true },
  });
}

// What the caller's active membership may see. Staff see no approvals.
function visibility(caller: Caller): Prisma.ApprovalRequestWhereInput {
  const none: Prisma.ApprovalRequestWhereInput = { id: { in: [] } };
  if (caller.kind !== 'person') return none;
  const { role, shopId, supplierId } = caller.session.membership;
  if (role === 'ops') return { assigneeRole: 'ops' };
  if (role === 'supplier') return supplierId ? { supplierId } : none;
  if (role === 'owner') return shopId ? { shopId } : none;
  return none;
}

async function toViews(
  db: Pick<Prisma.TransactionClient, 'user'>,
  rows: ApprovalRequest[],
): Promise<ApprovalView[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.proposedByUserId ? [r.proposedByUserId] : [])))];
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    summary: r.summary,
    whyNeeded: r.whyNeeded,
    amountSen: r.amountSen,
    evidence: r.evidence,
    proposedBy: {
      type: r.proposedByType,
      name: r.proposedByUserId ? (names.get(r.proposedByUserId) ?? null) : null,
    },
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    link: `/approvals/${r.id}`,
  }));
}

export async function listPendingApprovals(deps: AppDeps, caller: Caller): Promise<ApprovalView[]> {
  if (caller.kind !== 'person') throw forbidden();
  const rows = await deps.prisma.approvalRequest.findMany({
    where: {
      AND: [
        visibility(caller),
        { status: 'pending', assigneeRole: caller.session.membership.role },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return toViews(deps.prisma, rows);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function decideApproval(
  deps: AppDeps,
  caller: Caller,
  id: string,
  input: DecisionInput,
): Promise<ApprovalView> {
  if (caller.kind !== 'person') throw forbidden();
  const { role } = caller.session.membership;

  return withTransaction(deps, caller, async (ctx) => {
    if (!UUID.test(id)) throw notFound('Approval request');
    const locked = await ctx.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM approval_requests WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Approval request');
    const request = await ctx.tx.approvalRequest.findFirst({
      where: { AND: [{ id }, visibility(caller)] },
    });
    if (!request) throw notFound('Approval request');
    if (request.assigneeRole !== role) throw forbidden('This request is for a different role.');
    if (request.status !== 'pending') {
      throw conflict('ALREADY_DECIDED', 'This request has already been decided.');
    }
    const reason = input.reason?.trim();
    if (input.decision === 'reject' && !reason) {
      throw unprocessable('REASON_REQUIRED', 'Please give a reason for rejecting.');
    }
    const handler = handlers.get(request.type);
    if (!handler) throw new Error(`No approval handler registered for type "${request.type}".`);

    if (input.decision === 'approve') await handler.onApprove(ctx, request, input);
    else await handler.onReject(ctx, request, input);

    const updated = await ctx.tx.approvalRequest.update({
      where: { id },
      data: {
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        decidedByUserId: caller.session.userId,
        decidedAt: ctx.now,
        reason: reason || null,
      },
    });
    return (await toViews(ctx.tx, [updated]))[0]!;
  });
}

// A weekly basket is approved by paying for it on the basket screen, never from the inbox; a
// rejection there skips the basket for the week.
registerApprovalHandler('weekly_basket', {
  async onApprove() {
    throw unprocessable(
      'USE_BASKET_SCREEN',
      'Approve and pay for the basket on the basket screen.',
    );
  },
  async onReject(ctx, request, input) {
    await skipDraftBasket(ctx, request.subjectId, input.reason?.trim() || null);
  },
});
