import type { Allocation, Pickup, PickupStatus, Prisma } from '@/generated/prisma/client';
import { claimRefund } from '@/server/engine/claims';
import { formatRM } from '@/lib/format';
import { appendLog } from '@/server/modules/activity/log';
import { createApproval } from '@/server/modules/approvals/approvals';
import { approvalLink } from '@/server/modules/approvals/links';
import { EXTENSIONS, MAX_PHOTO_BYTES } from '@/server/modules/checks/photos';
import { completeConsignmentsOf, HANDED_OVER } from '@/server/modules/fulfilment/handover';
import { lockDestinations } from '@/server/modules/fulfilment/plan';
import {
  linesStillComing,
  LIVE_ALLOCATION,
  PICKUP_LINKS,
  UNCOLLECTED,
} from '@/server/modules/fulfilment/readiness';
import { emitEvent } from '@/server/modules/integration/events';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { lockShop } from '@/server/modules/payments/fee';
import { refreshRoundCompletion, roundsOfPickup } from '@/server/modules/rounds/completion';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { AppError, conflict, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';

const SHOP_ROLES = ['owner', 'staff'] as const;
const MAX_PHOTOS_PER_LINE = 3;
const HOUR_MS = 60 * 60 * 1000;
/** A collection can be checked for 72 hours; at exactly 72 hours the window is closed (P1-10). */
export const CHECK_WINDOW_MS = 72 * HOUR_MS;
/** The shop is reminded to check once 24 hours have passed (P1-10). */
export const CHECK_REMINDER_MS = 24 * HOUR_MS;

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

const windowClosed = () =>
  conflict(
    'CHECK_WINDOW_CLOSED',
    'The 72 hours to check this delivery are over. It was closed as received, not checked.',
  );

const photoNotFound = () =>
  unprocessable('PHOTO_NOT_FOUND', 'One of the photos was not uploaded. Please add it again.');

/**
 * The shop's owner or staff confirm what arrived (PRD §10-11, stories 77-81), one collection at a
 * time (O7, P1-8): "All received" closes its lines; problems (missing or damaged units, with up to
 * 3 photos a line) open a claim with an Ops approval. Allocations not listed count as received;
 * only the collection's own allocations can be listed. Without a `collectionId` the pickup's only
 * unchecked collection is meant (422 `COLLECTION_REQUIRED` when there are several); another
 * pickup's collection is 404. One check per collection: a second one, even a simultaneous double
 * tap, is 409 `CHECK_EXISTS`. The pickup then settles (`settlePickup`).
 */
export async function submitDeliveryCheck(
  deps: AppDeps,
  caller: Caller,
  pickupId: string,
  input: DeliveryCheckInput & { collectionId?: string },
): Promise<DeliveryCheckResult> {
  if (!UUID.test(pickupId)) throw notFound('Pickup');
  if (input.collectionId !== undefined && !UUID.test(input.collectionId)) {
    throw notFound('Collection');
  }
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

      const collectionId = await collectionToCheck(ctx, pickupId, input.collectionId);
      const allocations = await tx.allocation.findMany({
        where: { collectionId, allocated: { gt: 0 }, ...LIVE_ALLOCATION },
        orderBy: { id: 'asc' },
      });
      if ('allReceived' in input) {
        return recordAllReceived(ctx, pickup, collectionId, allocations);
      }
      return recordWithLines(ctx, pickup, collectionId, allocations, input.lines);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw checkExists();
    throw error;
  }
}

/**
 * The collection a check is for: the one named, or else the pickup's only unchecked one. The 72
 * hour window is tested first (R4), so a collection the job already closed as "not checked" also
 * answers 409 `CHECK_WINDOW_CLOSED`, not `CHECK_EXISTS`.
 */
async function collectionToCheck(
  ctx: TxContext,
  pickupId: string,
  named: string | undefined,
): Promise<string> {
  const collections = await ctx.tx.pickupCollection.findMany({
    where: { pickupId },
    select: { id: true, collectedAt: true, deliveryCheck: { select: { id: true } } },
    orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
  });
  const closed = (c: { collectedAt: Date }) =>
    ctx.now.getTime() >= c.collectedAt.getTime() + CHECK_WINDOW_MS;
  if (named !== undefined) {
    const collection = collections.find((c) => c.id === named);
    if (!collection) throw notFound('Collection');
    if (closed(collection)) throw windowClosed();
    if (collection.deliveryCheck) throw checkExists();
    return collection.id;
  }
  const unchecked = collections.filter((c) => !c.deliveryCheck);
  if (unchecked.length === 0) {
    if (collections.some(closed)) throw windowClosed();
    if (collections.length > 0) throw checkExists();
    throw conflict('NOT_COLLECTED', 'These goods have not been handed over yet.');
  }
  if (unchecked.length > 1) {
    if (unchecked.every(closed)) throw windowClosed();
    throw unprocessable(
      'COLLECTION_REQUIRED',
      'These goods were collected in parts. Choose which part you are checking.',
    );
  }
  if (closed(unchecked[0]!)) throw windowClosed();
  return unchecked[0]!.id;
}

/**
 * Moves a pickup on once its goods are all handed over (P1-8). With nothing left to collect, a
 * pickup still waiting for goods (the rest was cancelled late) becomes `collected` (or
 * `delivered`); once every collection is checked it is `checked` while a claim is undecided, else
 * `closed`, and the rounds it carried are refreshed. Leaves it alone while goods are still to
 * come, including those of a round for its place and date not hub-checked yet. In the caller's transaction (shop and destination locks held). Returns the pickup's status.
 */
export async function settlePickup(ctx: TxContext, pickupId: string): Promise<PickupStatus> {
  const { tx, now } = ctx;
  const pickup = await tx.pickup.findUniqueOrThrow({ where: { id: pickupId } });
  if (pickup.status === 'closed') return pickup.status;
  const left = await tx.allocation.count({ where: { pickupId, ...UNCOLLECTED } });
  if (left > 0) return pickup.status;
  // A round for this place and date not hub-checked yet still brings goods here (P1-8).
  if (!HANDED_OVER.includes(pickup.status) && (await linesStillComing(tx, pickup)) > 0) {
    return pickup.status;
  }
  let status = pickup.status;
  if (!HANDED_OVER.includes(status)) {
    status = pickup.destinationType === 'door' ? 'delivered' : 'collected';
    await tx.pickup.update({
      where: { id: pickupId },
      data: { status, collectedAt: pickup.collectedAt ?? now },
    });
    // The rest was cancelled late: an arrived consignment with nothing left on it is done.
    await completeConsignmentsOf(ctx, pickupId);
  }
  const unchecked = await tx.pickupCollection.count({
    where: { pickupId, deliveryCheck: { is: null } },
  });
  if (unchecked > 0) return status;
  const undecided = await tx.claim.count({
    where: { deliveryCheck: { pickupId }, status: 'submitted' },
  });
  const settled = undecided > 0 ? 'checked' : 'closed';
  if (settled !== status) {
    await tx.pickup.update({ where: { id: pickupId }, data: { status: settled } });
  }
  if (settled === 'closed') {
    await refreshRoundCompletion(ctx, await roundsOfPickup(ctx, pickupId));
  }
  return settled;
}

/**
 * Records "All received" for a collection, inside the caller's transaction (shop and destination
 * locks held): a check with every line fully received and those lines' participations `closed`,
 * then the pickup settles (`settlePickup`). Shared by the shop's own submit and by the
 * background-shop simulation, which has no user and logs a reason.
 */
export async function recordAllReceived(
  ctx: TxContext,
  pickup: Pickup,
  collectionId: string,
  allocations?: Allocation[],
  opts: { reason?: string } = {},
): Promise<DeliveryCheckResult> {
  const { tx, now } = ctx;
  const lines =
    allocations ??
    (await tx.allocation.findMany({
      where: { collectionId, allocated: { gt: 0 }, ...LIVE_ALLOCATION },
      orderBy: { id: 'asc' },
    }));
  const check = await createCheck(ctx, pickup, collectionId, lines, 'all_received');
  const partIds = lines.map((a) => a.participationId);
  await tx.participation.updateMany({
    where: { id: { in: partIds } },
    data: { status: 'closed', updatedAt: now },
  });
  const status = await settlePickup(ctx, pickup.id);
  await logCheck(ctx, pickup, check.id, 'all_received', status, null, opts.reason);
  await emitEvent(ctx, 'delivery.checked', {
    pickupId: pickup.id,
    shopId: pickup.shopId,
    result: 'all_received',
  });
  return { checkId: check.id, result: 'all_received', claimId: null };
}

/**
 * Closes a collection nobody checked within 72 hours as "received, not checked" (P1-10), inside the
 * caller's transaction (shop and destination locks held; the caller has seen the window is over and
 * the collection unchecked). A system check with no submitter and no lines, so its savings stay
 * estimated and no claim exists. Its live participations close as for "All received", then the
 * pickup settles (`settlePickup`).
 */
export async function recordNotChecked(
  ctx: TxContext,
  pickup: Pickup,
  collectionId: string,
): Promise<string> {
  const { tx, now } = ctx;
  const allocations = await tx.allocation.findMany({
    where: { collectionId, allocated: { gt: 0 }, ...LIVE_ALLOCATION },
    select: { participationId: true },
  });
  const check = await tx.deliveryCheck.create({
    data: {
      pickupId: pickup.id,
      collectionId,
      submittedByUserId: null,
      submittedAt: now,
      result: 'not_checked',
    },
  });
  await tx.participation.updateMany({
    where: { id: { in: allocations.map((a) => a.participationId) } },
    data: { status: 'closed', updatedAt: now },
  });
  const status = await settlePickup(ctx, pickup.id);
  await logCheck(
    ctx,
    pickup,
    check.id,
    'not_checked',
    status,
    null,
    'Nobody checked the goods within 72 hours',
  );
  await emitEvent(ctx, 'delivery.checked', {
    pickupId: pickup.id,
    shopId: pickup.shopId,
    result: 'not_checked',
  });
  return check.id;
}

async function createCheck(
  ctx: TxContext,
  pickup: Pickup,
  collectionId: string,
  allocations: Allocation[],
  result: 'all_received' | 'issues',
  issues: Map<string, { missing: number; damaged: number }> = new Map(),
) {
  const { tx, now, actor } = ctx;
  const check = await tx.deliveryCheck.create({
    data: {
      pickupId: pickup.id,
      collectionId,
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
  collectionId: string,
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
  if (issues.size === 0) return recordAllReceived(ctx, pickup, collectionId, allocations);

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

  const check = await createCheck(ctx, pickup, collectionId, allocations, 'issues', issues);
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
  const status = await settlePickup(ctx, pickup.id);

  await logCheck(ctx, pickup, check.id, 'issues', status, claim.id);
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
