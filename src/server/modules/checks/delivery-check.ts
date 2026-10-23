import type { Allocation, Pickup, Prisma } from '@/generated/prisma/client';
import { claimRefund } from '@/server/engine/claims';
import { formatRM } from '@/lib/format';
import { appendLog } from '@/server/modules/activity/log';
import { createApproval } from '@/server/modules/approvals/approvals';
import { approvalLink } from '@/server/modules/approvals/links';
import { EXTENSIONS, MAX_PHOTO_BYTES } from '@/server/modules/checks/photos';
import { lockDestinations } from '@/server/modules/fulfilment/plan';
import { PICKUP_LINKS } from '@/server/modules/fulfilment/readiness';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { lockShop } from '@/server/modules/payments/fee';
import { refreshRoundCompletion } from '@/server/modules/rounds/completion';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { AppError, conflict, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';

const SHOP_ROLES = ['owner', 'staff'] as const;
const MAX_PHOTOS_PER_LINE = 3;

type LineInput = { allocationId: string; missing: number; damaged: number; photoIds: string[] };

export type DeliveryCheckInput = { allReceived: true } | { lines: LineInput[] };

export type DeliveryCheckResult = {
  checkId: string;
  result: 'all_received' | 'issues';
  claimId: string | null;
};

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

const checkExists = () => conflict('CHECK_EXISTS', 'This delivery has already been checked.');

const photoNotFound = () =>
  unprocessable('PHOTO_NOT_FOUND', 'One of the photos was not uploaded. Please add it again.');

/**
 * The shop's owner or staff confirm what arrived (PRD §10-11, stories 77-81): "All received"
 * closes the pickup; problems (missing or damaged units, with up to 3 photos a line) open a claim
 * with an Ops approval and leave the pickup `checked`. Allocations not listed count as received.
 * One check per pickup: a second one, even a simultaneous double tap, is 409 `CHECK_EXISTS`.
 */
export async function submitDeliveryCheck(
  deps: AppDeps,
  caller: Caller,
  pickupId: string,
  input: DeliveryCheckInput,
): Promise<DeliveryCheckResult> {
  if (!UUID.test(pickupId)) throw notFound('Pickup');
  try {
    return await withTransaction(deps, caller, async (ctx) => {
      const { tx } = ctx;
      const head = await tx.pickup.findUnique({
        where: { id: pickupId },
        select: { shopId: true, destinationKey: true },
      });
      if (!head) throw notFound('Pickup');
      try {
        requireShopAccess(caller, head.shopId, SHOP_ROLES);
      } catch (error) {
        if (error instanceof AppError && error.status === 404) throw notFound('Pickup');
        throw error;
      }
      await lockShop(ctx, head.shopId);
      await lockDestinations(ctx, [head.destinationKey]);
      const pickup = await tx.pickup.findUniqueOrThrow({ where: { id: pickupId } });

      if (await tx.deliveryCheck.findUnique({ where: { pickupId } })) throw checkExists();
      if (pickup.status !== 'collected' && pickup.status !== 'delivered') {
        throw conflict('NOT_COLLECTED', 'These goods have not been handed over yet.');
      }
      const allocations = await tx.allocation.findMany({
        where: { pickupId, allocated: { gt: 0 } },
        orderBy: { id: 'asc' },
      });
      if ('allReceived' in input) return recordAllReceived(ctx, pickup, allocations);
      return recordWithLines(ctx, pickup, allocations, input.lines);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw checkExists();
    throw error;
  }
}

/**
 * Records "All received" for a handed-over pickup, inside the caller's transaction (shop and
 * destination locks held): a check with every line fully received, participations `closed`, the
 * pickup `checked` then `closed`, and the rounds it carried refreshed. Shared by the shop's own
 * submit and by the background-shop simulation, which has no user and logs a reason.
 */
export async function recordAllReceived(
  ctx: TxContext,
  pickup: Pickup,
  allocations?: Allocation[],
  opts: { reason?: string } = {},
): Promise<DeliveryCheckResult> {
  const { tx, now } = ctx;
  const lines =
    allocations ??
    (await tx.allocation.findMany({
      where: { pickupId: pickup.id, allocated: { gt: 0 } },
      orderBy: { id: 'asc' },
    }));
  const check = await createCheck(ctx, pickup, lines, 'all_received');
  const partIds = lines.map((a) => a.participationId);
  await tx.pickup.updateMany({
    where: { id: pickup.id, status: { in: ['collected', 'delivered'] } },
    data: { status: 'checked' },
  });
  await tx.pickup.update({ where: { id: pickup.id }, data: { status: 'closed' } });
  await tx.participation.updateMany({
    where: { id: { in: partIds } },
    data: { status: 'closed', updatedAt: now },
  });
  await logCheck(ctx, pickup, check.id, 'all_received', 'closed', null, opts.reason);
  await emitEvent(ctx, 'delivery.checked', {
    pickupId: pickup.id,
    shopId: pickup.shopId,
    result: 'all_received',
  });
  const parts = await tx.participation.findMany({
    where: { id: { in: partIds } },
    select: { roundId: true },
  });
  await refreshRoundCompletion(
    ctx,
    parts.map((p) => p.roundId),
  );
  return { checkId: check.id, result: 'all_received', claimId: null };
}

async function createCheck(
  ctx: TxContext,
  pickup: Pickup,
  allocations: Allocation[],
  result: 'all_received' | 'issues',
  issues: Map<string, { missing: number; damaged: number }> = new Map(),
) {
  const { tx, now, actor } = ctx;
  const check = await tx.deliveryCheck.create({
    data: {
      pickupId: pickup.id,
      submittedByUserId: actor.type === 'person' ? actor.userId : null,
      submittedAt: now,
      result,
    },
  });
  const lineIds = new Map<string, string>();
  for (const a of allocations) {
    const { missing, damaged } = issues.get(a.id) ?? { missing: 0, damaged: 0 };
    const line = await tx.deliveryCheckLine.create({
      data: {
        deliveryCheckId: check.id,
        allocationId: a.id,
        expected: a.allocated,
        receivedGood: a.allocated - missing - damaged,
        missing,
        damaged,
      },
    });
    lineIds.set(a.id, line.id);
  }
  return { id: check.id, lineIds };
}

async function logCheck(
  ctx: TxContext,
  pickup: Pickup,
  checkId: string,
  result: string,
  pickupStatus: string,
  claimId: string | null,
  reason?: string,
) {
  await appendLog(ctx, {
    action: 'check.delivery_check_submitted',
    subjectType: 'delivery_check',
    subjectId: checkId,
    scope: { shopId: pickup.shopId },
    before: { pickupStatus: pickup.status },
    after: { result, pickupStatus, pickupId: pickup.id, ...(claimId ? { claimId } : {}) },
    ...(reason ? { reason } : {}),
  });
}

async function recordWithLines(
  ctx: TxContext,
  pickup: Pickup,
  allocations: Allocation[],
  inputLines: LineInput[],
): Promise<DeliveryCheckResult> {
  const { tx, now, deps } = ctx;
  const byId = new Map(allocations.map((a) => [a.id, a]));
  const seen = new Set<string>();
  for (const l of inputLines) {
    const details = { allocationId: l.allocationId };
    if (!byId.has(l.allocationId)) {
      throw unprocessable('UNKNOWN_LINE', 'That item is not part of this delivery.', details);
    }
    if (seen.has(l.allocationId)) {
      throw unprocessable('DUPLICATE_LINE', 'Each item can be reported once.', details);
    }
    seen.add(l.allocationId);
    if (l.photoIds.length > MAX_PHOTOS_PER_LINE) {
      throw unprocessable('TOO_MANY_PHOTOS', 'You can add up to 3 photos for each item.', details);
    }
  }

  const parts = await tx.participation.findMany({
    where: { id: { in: allocations.map((a) => a.participationId) } },
    include: {
      round: { include: { product: { select: { shortName: true, unitName: true } } } },
    },
  });
  const partOf = new Map(parts.map((p) => [p.id, p]));

  const issues = new Map<string, { missing: number; damaged: number }>();
  const refunds = new Map<string, number>();
  for (const l of inputLines) {
    const a = byId.get(l.allocationId)!;
    const part = partOf.get(a.participationId)!;
    if (part.finalAllInSen === null) {
      throw unprocessable('NO_FINAL_PRICE', 'This item has no final price yet.', {
        allocationId: a.id,
      });
    }
    const refund = claimRefund({
      final: {
        goodsSen: part.finalGoodsSen ?? 0,
        feeSen: part.finalFeeSen ?? 0,
        shippingSen: part.unitShippingSen,
        allInSen: part.finalAllInSen,
      },
      allocated: a.allocated,
      missing: l.missing,
      damaged: l.damaged,
    });
    if (!refund.ok) {
      throw unprocessable('MORE_THAN_ALLOCATED', refund.message, { allocationId: a.id });
    }
    if (l.missing + l.damaged === 0) continue;
    issues.set(a.id, { missing: l.missing, damaged: l.damaged });
    refunds.set(a.id, refund.refundSen);
  }
  if (issues.size === 0) return recordAllReceived(ctx, pickup, allocations);

  // Photos must be this pickup's, not used on a line yet, and really stored (1 byte to 5 MB).
  const photoIds = inputLines.filter((l) => issues.has(l.allocationId)).flatMap((l) => l.photoIds);
  if (new Set(photoIds).size !== photoIds.length || photoIds.some((id) => !UUID.test(id))) {
    throw photoNotFound();
  }
  const photos = await tx.photo.findMany({
    where: {
      id: { in: photoIds },
      pickupId: pickup.id,
      deliveryCheckLineId: null,
      deletedAt: null,
    },
  });
  if (photos.length !== photoIds.length) throw photoNotFound();
  for (const photo of photos) {
    const stored = await deps.storage.statObject('delivery-photos', photo.storageKey);
    if (
      !stored ||
      stored.sizeBytes <= 0 ||
      stored.sizeBytes > MAX_PHOTO_BYTES ||
      !Object.hasOwn(EXTENSIONS, stored.contentType)
    ) {
      throw photoNotFound();
    }
  }

  const check = await createCheck(ctx, pickup, allocations, 'issues', issues);
  await tx.participation.updateMany({
    where: { id: { in: allocations.map((a) => a.participationId) } },
    data: { status: 'received', updatedAt: now },
  });
  for (const l of inputLines) {
    if (!issues.has(l.allocationId) || l.photoIds.length === 0) continue;
    await tx.photo.updateMany({
      where: { id: { in: l.photoIds }, deliveryCheckLineId: null },
      data: { deliveryCheckLineId: check.lineIds.get(l.allocationId)! },
    });
  }

  // In the order the shop reported them, so the notices read the same way.
  const issueAllocs = inputLines
    .filter((l) => issues.has(l.allocationId))
    .map((l) => byId.get(l.allocationId)!);
  const total = [...refunds.values()].reduce((sum, v) => sum + v, 0);
  const units = issueAllocs.reduce(
    (sum, a) => sum + issues.get(a.id)!.missing + issues.get(a.id)!.damaged,
    0,
  );
  const claim = await tx.claim.create({
    data: {
      deliveryCheckId: check.id,
      shopId: pickup.shopId,
      totalRefundSen: total,
      status: 'submitted',
      lines: {
        create: issueAllocs.map((a) => ({
          allocationId: a.id,
          missing: issues.get(a.id)!.missing,
          damaged: issues.get(a.id)!.damaged,
          refundSen: refunds.get(a.id)!,
        })),
      },
    },
  });

  const shop = await tx.shop.findUniqueOrThrow({
    where: { id: pickup.shopId },
    select: { name: true },
  });
  const productOf = (a: Allocation) => partOf.get(a.participationId)!.round.product;
  const photoCount = (allocationId: string) =>
    inputLines.find((l) => l.allocationId === allocationId)?.photoIds.length ?? 0;
  const approval = await createApproval(ctx, {
    type: 'claim',
    subjectType: 'claim',
    subjectId: claim.id,
    shopId: pickup.shopId,
    assigneeRole: 'ops',
    amountSen: total,
    summary: `Claim for ${formatRM(total)} from ${shop.name}`,
    whyNeeded: 'The shop reported missing or damaged goods. A refund needs a decision.',
    evidence: {
      shopName: shop.name,
      lines: issueAllocs.map((a) => ({
        productShortName: productOf(a).shortName,
        allocated: a.allocated,
        missing: issues.get(a.id)!.missing,
        damaged: issues.get(a.id)!.damaged,
        refundSen: refunds.get(a.id)!,
        photoCount: photoCount(a.id),
      })),
      hubChecks: await hubChecksOf(ctx, issueAllocs, partOf),
      consignments: await consignmentsOf(ctx, issueAllocs),
    } as Prisma.InputJsonValue,
  });
  await tx.claim.update({ where: { id: claim.id }, data: { approvalRequestId: approval.id } });
  await tx.pickup.updateMany({
    where: { id: pickup.id, status: { in: ['collected', 'delivered'] } },
    data: { status: 'checked' },
  });

  await logCheck(ctx, pickup, check.id, 'issues', 'checked', claim.id);
  await appendLog(ctx, {
    action: 'claim.submitted',
    subjectType: 'claim',
    subjectId: claim.id,
    scope: { shopId: pickup.shopId },
    after: { totalRefundSen: total, units, approvalRequestId: approval.id },
  });
  await emitEvent(ctx, 'delivery.checked', {
    pickupId: pickup.id,
    shopId: pickup.shopId,
    result: 'issues',
  });
  await emitEvent(ctx, 'claim.submitted', {
    claimId: claim.id,
    shopId: pickup.shopId,
    units,
    refundSen: total,
  });

  const reporter =
    ctx.actor.type === 'person'
      ? await tx.user.findUniqueOrThrow({ where: { id: ctx.actor.userId } })
      : null;
  const phrasing = issueAllocs.map((a) => ({ ...issues.get(a.id)!, ...productOf(a) }));
  for (const [role, link] of PICKUP_LINKS) {
    await notify(ctx, {
      type: 'claim.submitted',
      audience: { shopId: pickup.shopId, roles: [role] },
      link: link(pickup.id),
      message: TEMPLATES['claim.submitted']({
        reporterName: reporter?.displayName ?? 'The shop',
        lines: phrasing,
        totalSen: total,
      }),
      dedupeKey: `claim.submitted:${claim.id}`,
    });
  }
  await notify(ctx, {
    type: 'ops.claim_needed',
    audience: { operator: true, roles: ['ops'] },
    link: approvalLink('claim', claim.id, approval.id),
    message: TEMPLATES['ops.claim_needed']({ shopName: shop.name, totalSen: total }),
    dedupeKey: `ops.claim_needed:${claim.id}`,
  });

  return { checkId: check.id, result: 'issues', claimId: claim.id };
}

type PartMap = Map<string, { roundId: string }>;

/** The hub check of each round the claimed goods came from (Ops evidence). */
async function hubChecksOf(ctx: TxContext, allocs: Allocation[], partOf: PartMap) {
  const roundIds = [...new Set(allocs.map((a) => partOf.get(a.participationId)!.roundId))].sort();
  const orders = await ctx.tx.supplierOrder.findMany({
    where: { roundId: { in: roundIds } },
    include: { hubCheck: true, round: { include: { product: { select: { shortName: true } } } } },
    orderBy: { id: 'asc' },
  });
  return orders.map((o) => ({
    productShortName: o.round.product.shortName,
    goodUnits: o.hubCheck?.goodUnits ?? null,
    damagedUnits: o.hubCheck?.damagedUnits ?? null,
    shortfallUnits: o.hubCheck?.shortfallUnits ?? null,
    checkedAt: o.hubCheck?.checkedAt.toISOString() ?? null,
  }));
}

/** The consignments that carried the claimed goods, with their status history (Ops evidence). */
async function consignmentsOf(ctx: TxContext, allocs: Allocation[]) {
  const ids = [...new Set(allocs.flatMap((a) => (a.consignmentId ? [a.consignmentId] : [])))];
  const rows = await ctx.tx.consignment.findMany({
    where: { id: { in: ids } },
    orderBy: { id: 'asc' },
  });
  return rows.map((c) => ({
    consignmentId: c.id,
    status: c.status,
    deliveryDate: c.deliveryDate,
    history: c.statusHistory,
  }));
}
