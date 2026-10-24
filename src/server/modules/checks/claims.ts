import type { ApprovalRequest } from '@/generated/prisma/client';
import { appendLog } from '@/server/modules/activity/log';
import type { DecisionInput } from '@/server/modules/approvals/approvals';
import { settlePickup } from '@/server/modules/checks/delivery-check';
import { VIEW_LINK_SECONDS } from '@/server/modules/checks/photos';
import { lockDestinations } from '@/server/modules/fulfilment/plan';
import { LIVE_ALLOCATION, PICKUP_LINKS } from '@/server/modules/fulfilment/readiness';
import { emitEvent } from '@/server/modules/integration/events';
import { post } from '@/server/modules/ledger/post';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { lockShop } from '@/server/modules/payments/fee';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import type { TxContext } from '@/server/platform/tx';

export type ClaimView = {
  claimId: string;
  /** The Ops decision request (Ops only; owners get null). */
  approvalId: string | null;
  status: 'submitted' | 'approved' | 'rejected';
  totalRefundSen: number;
  reason: string | null;
  lines: {
    productName: string;
    missing: number;
    damaged: number;
    refundSen: number;
    photoUrls: string[];
  }[];
  check: {
    submittedBy: string | null;
    submittedAt: string;
    lines: {
      productName: string;
      expected: number;
      receivedGood: number;
      missing: number;
      damaged: number;
    }[];
  };
  hubCheck: {
    goodUnits: number;
    damagedUnits: number;
    notes: string | null;
    checkedAt: string;
  } | null;
  consignmentHistory: { status: string; at: string }[];
};

type Db = Pick<TxContext['tx'], 'participation'>;

/** The product name, unit name and round of each allocation's participation. */
async function productsOf(db: Db, allocations: { id: string; participationId: string }[]) {
  const parts = await db.participation.findMany({
    where: { id: { in: allocations.map((a) => a.participationId) } },
    select: {
      id: true,
      roundId: true,
      round: { select: { unitName: true, product: { select: { name: true } } } },
    },
  });
  const byPart = new Map(parts.map((p) => [p.id, p]));
  return new Map(
    allocations.map((a) => {
      const p = byPart.get(a.participationId)!;
      return [
        a.id,
        { roundId: p.roundId, name: p.round.product.name, unitName: p.round.unitName },
      ] as const;
    }),
  );
}

/**
 * One claim with everything Ops needs to decide it: the photos (10-minute links), the shop's
 * check, the hub's count and the consignment's history. Only the shop's owner and Ops can read it
 * (it carries money, so staff get 404 like any other shop or supplier).
 */
export async function getClaimForCaller(
  deps: AppDeps,
  caller: Caller,
  claimId: string,
): Promise<ClaimView> {
  if (!UUID.test(claimId)) throw notFound('Claim');
  const claim = await deps.prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      lines: { include: { allocation: true }, orderBy: { id: 'asc' } },
      deliveryCheck: {
        include: { lines: { include: { allocation: true }, orderBy: { id: 'asc' } } },
      },
    },
  });
  if (!claim) throw notFound('Claim');
  try {
    requireShopAccess(caller, claim.shopId, ['owner', 'ops']);
  } catch {
    throw notFound('Claim');
  }

  const check = claim.deliveryCheck;
  const allocationIds = check.lines.map((l) => l.allocationId);
  const allocations = await deps.prisma.allocation.findMany({
    where: { id: { in: allocationIds } },
  });
  const allocOf = new Map(allocations.map((a) => [a.id, a]));
  const products = await productsOf(deps.prisma, allocations);
  const nameOf = (allocationId: string) => products.get(allocationId)?.name ?? '';

  const photos = await deps.prisma.photo.findMany({
    where: { deliveryCheckLineId: { in: check.lines.map((l) => l.id) }, deletedAt: null },
    orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
  });
  const checkLineOf = new Map(check.lines.map((l) => [l.allocationId, l.id]));

  const lines: ClaimView['lines'] = [];
  for (const l of claim.lines) {
    const checkLineId = checkLineOf.get(l.allocationId);
    const photoUrls: string[] = [];
    for (const ph of photos.filter((x) => x.deliveryCheckLineId === checkLineId)) {
      photoUrls.push(
        await deps.storage.createSignedReadUrl('delivery-photos', ph.storageKey, VIEW_LINK_SECONDS),
      );
    }
    lines.push({
      productName: nameOf(l.allocationId),
      missing: l.missing,
      damaged: l.damaged,
      refundSen: l.refundSen,
      photoUrls,
    });
  }

  const submitter = check.submittedByUserId
    ? await deps.prisma.user.findUnique({
        where: { id: check.submittedByUserId },
        select: { displayName: true },
      })
    : null;

  // The hub count of the first claimed line's round, and the history of the consignments that
  // carried the claimed goods.
  const claimed = claim.lines.flatMap((l) => {
    const a = allocOf.get(l.allocationId);
    return a ? [a] : [];
  });
  const roundId = claimed[0] ? products.get(claimed[0].id)?.roundId : undefined;
  const order = roundId
    ? await deps.prisma.supplierOrder.findFirst({
        where: { roundId, hubCheck: { isNot: null } },
        include: { hubCheck: true },
        orderBy: { id: 'asc' },
      })
    : null;
  const consignmentIds = [
    ...new Set(claimed.flatMap((a) => (a.consignmentId ? [a.consignmentId] : []))),
  ].sort();
  const consignments = await deps.prisma.consignment.findMany({
    where: { id: { in: consignmentIds } },
    orderBy: { id: 'asc' },
  });
  const consignmentHistory = consignments.flatMap((c) =>
    (c.statusHistory as unknown as { status: string; at: string }[]).map((h) => ({
      status: h.status,
      at: h.at,
    })),
  );

  return {
    claimId: claim.id,
    approvalId:
      caller.kind === 'person' && caller.session.membership.role === 'ops'
        ? claim.approvalRequestId
        : null,
    status: claim.status,
    totalRefundSen: claim.totalRefundSen,
    reason: claim.reason,
    lines,
    check: {
      submittedBy: submitter?.displayName ?? null,
      submittedAt: check.submittedAt.toISOString(),
      lines: check.lines.map((l) => ({
        productName: nameOf(l.allocationId),
        expected: l.expected,
        receivedGood: l.receivedGood,
        missing: l.missing,
        damaged: l.damaged,
      })),
    },
    hubCheck: order?.hubCheck
      ? {
          goodUnits: order.hubCheck.goodUnits,
          damagedUnits: order.hubCheck.damagedUnits,
          notes: order.hubCheck.notes,
          checkedAt: order.hubCheck.checkedAt.toISOString(),
        }
      : null,
    consignmentHistory,
  };
}

/** Locks the claim's shop and destination, then loads the claim; refuses one already decided. */
async function lockedClaim(ctx: TxContext, request: ApprovalRequest) {
  const { tx } = ctx;
  const head = await tx.claim.findUniqueOrThrow({
    where: { id: request.subjectId },
    include: { deliveryCheck: { select: { pickupId: true, collectionId: true } } },
  });
  const pickup = await tx.pickup.findUniqueOrThrow({
    where: { id: head.deliveryCheck.pickupId },
    select: { id: true, destinationKey: true },
  });
  await lockShop(ctx, head.shopId);
  await lockDestinations(ctx, [pickup.destinationKey]);
  const claim = await tx.claim.findUniqueOrThrow({
    where: { id: head.id },
    include: { lines: { include: { allocation: true } } },
  });
  if (claim.status !== 'submitted') {
    throw conflict('CLAIM_DECIDED', 'This claim has already been decided.');
  }
  const products = await productsOf(
    tx,
    claim.lines.map((l) => l.allocation),
  );
  return { claim, pickupId: pickup.id, collectionId: head.deliveryCheck.collectionId, products };
}

/**
 * Closes the participations of the claim's collection, then settles its pickup: it closes (and
 * the rounds it carried are refreshed) once nothing is left to collect, check or decide (P1-8).
 */
async function closeClaimedGoods(ctx: TxContext, pickupId: string, collectionId: string) {
  const { tx, now } = ctx;
  const allocations = await tx.allocation.findMany({
    where: { collectionId, allocated: { gt: 0 }, ...LIVE_ALLOCATION },
    select: { participationId: true },
  });
  const partIds = allocations.map((a) => a.participationId);
  await tx.participation.updateMany({
    where: { id: { in: partIds } },
    data: { status: 'closed', updatedAt: now },
  });
  await settlePickup(ctx, pickupId);
}

/** "damaged carton" for the notice: the adjective by what occurs, the noun shared or "item". */
function unitPhrase({ claim, products }: Awaited<ReturnType<typeof lockedClaim>>) {
  const units = claim.lines.reduce((sum, l) => sum + l.missing + l.damaged, 0);
  const hasMissing = claim.lines.some((l) => l.missing > 0);
  const hasDamaged = claim.lines.some((l) => l.damaged > 0);
  const kind = hasMissing && hasDamaged ? 'missing or damaged' : hasMissing ? 'missing' : 'damaged';
  const names = new Set(claim.lines.map((l) => products.get(l.allocationId)!.unitName));
  const unitName = names.size === 1 ? [...names][0]! : 'item';
  return { units, kind: kind as 'missing' | 'damaged' | 'missing or damaged', unitName };
}

async function decide(
  ctx: TxContext,
  claimId: string,
  status: 'approved' | 'rejected',
  reason: string | null,
) {
  const { tx, now, actor } = ctx;
  await tx.claim.update({
    where: { id: claimId },
    data: {
      status,
      decidedByUserId: actor.type === 'person' ? actor.userId : null,
      decidedAt: now,
      reason,
    },
  });
}

async function tellShop(
  ctx: TxContext,
  shopId: string,
  pickupId: string,
  claimId: string,
  message: ReturnType<(typeof TEMPLATES)['claim.decided']>,
) {
  for (const [role, link] of PICKUP_LINKS) {
    await notify(ctx, {
      type: 'claim.decided',
      audience: { shopId, roles: [role] },
      link: link(pickupId),
      message,
      dedupeKey: `claim.decided:${claimId}`,
    });
  }
}

/** Ops approves: the refund goes to the shop's balance and the pickup is closed (story 128). */
export async function approveClaim(ctx: TxContext, request: ApprovalRequest): Promise<void> {
  const locked = await lockedClaim(ctx, request);
  const { claim, pickupId, collectionId } = locked;
  const phrase = unitPhrase(locked);
  if (claim.totalRefundSen > 0) {
    await post(ctx, {
      from: { kind: 'claims_expense' },
      to: { kind: 'shop_balance', shopId: claim.shopId },
      amountSen: claim.totalRefundSen,
      kind: 'refund_claim',
      refs: { claimId: claim.id, shopId: claim.shopId },
    });
  }
  await decide(ctx, claim.id, 'approved', null);
  await closeClaimedGoods(ctx, pickupId, collectionId);
  await appendLog(ctx, {
    action: 'claim.approved',
    subjectType: 'claim',
    subjectId: claim.id,
    scope: { shopId: claim.shopId, operator: true },
    before: { status: 'submitted' },
    after: { status: 'approved', refundSen: claim.totalRefundSen, pickupId },
  });
  await appendLog(ctx, {
    action: 'refund.issued',
    subjectType: 'shop',
    subjectId: claim.shopId,
    scope: { shopId: claim.shopId },
    after: { amountSen: claim.totalRefundSen, kind: 'claim', claimId: claim.id },
  });
  await emitEvent(ctx, 'claim.decided', {
    claimId: claim.id,
    shopId: claim.shopId,
    units: phrase.units,
    decision: 'approved',
    refundSen: claim.totalRefundSen,
  });
  await emitEvent(ctx, 'refund.issued', {
    shopId: claim.shopId,
    amountSen: claim.totalRefundSen,
    kind: 'claim',
    referenceId: claim.id,
  });
  await tellShop(
    ctx,
    claim.shopId,
    pickupId,
    claim.id,
    TEMPLATES['claim.decided']({
      decision: 'approved',
      refundSen: claim.totalRefundSen,
      ...phrase,
    }),
  );
}

/** Ops rejects with a reason: no refund, the pickup is closed and the shop is told why. */
export async function rejectClaim(
  ctx: TxContext,
  request: ApprovalRequest,
  input: DecisionInput,
): Promise<void> {
  const reason = input.reason?.trim() ?? '';
  const locked = await lockedClaim(ctx, request);
  const { claim, pickupId, collectionId } = locked;
  const phrase = unitPhrase(locked);
  await decide(ctx, claim.id, 'rejected', reason);
  await closeClaimedGoods(ctx, pickupId, collectionId);
  await appendLog(ctx, {
    action: 'claim.rejected',
    subjectType: 'claim',
    subjectId: claim.id,
    scope: { shopId: claim.shopId, operator: true },
    before: { status: 'submitted' },
    after: { status: 'rejected', pickupId },
    reason,
  });
  await emitEvent(ctx, 'claim.decided', {
    claimId: claim.id,
    shopId: claim.shopId,
    units: phrase.units,
    decision: 'rejected',
    refundSen: 0,
  });
  await tellShop(
    ctx,
    claim.shopId,
    pickupId,
    claim.id,
    TEMPLATES['claim.decided']({ decision: 'rejected', reason }),
  );
}
