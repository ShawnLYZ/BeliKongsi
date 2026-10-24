import type { ApprovalRequest, Prisma } from '@/generated/prisma/client';
import type { Caller } from '@/server/platform/caller';
import { resolveClock } from '@/server/adapters/clock';
import type { AppDeps } from '@/server/platform/deps';
import { conflict, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { appendLog } from '../activity/log';
import { createApproval, type DecisionInput } from '../approvals/approvals';
import { balanceOf } from '../ledger/accounts';
import { notify, TEMPLATES } from '../notifications/notify';
import { lockShop } from '../payments/fee';

export type DeletionBlockers = {
  activeRounds: number;
  openPickups: number;
  openClaims: number;
  pendingPayments: number;
  balanceSen: number;
};

export type DeletionRequestResult = DeletionBlockers & { approvalId: string; canApprove: boolean };

// A round is finished once it has completed, been cancelled, failed to form or closed empty.
const FINISHED_ROUNDS = ['completed', 'cancelled', 'failed', 'empty'] as const;
// A participation is settled once it has been cancelled (on time or late), dropped, refunded or
// closed.
const SETTLED_PARTICIPATIONS = [
  'cancelled',
  'dropped_price_limit',
  'refunded_failed',
  'refunded_round_cancelled',
  'closed',
  'cancelled_late',
] as const;

const ANONYMOUS_USER = 'Deleted user';

type Replacement = [from: string, to: string];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces whole-word occurrences only, so a short name never rewrites a fragment of a word. */
function scrubText(text: string, replacements: Replacement[]): string {
  let out = text;
  for (const [from, to] of [...replacements].sort((a, b) => b[0].length - a[0].length)) {
    if (!from.trim()) continue;
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from)}(?![\\p{L}\\p{N}])`, 'gu'),
      to,
    );
  }
  return out;
}

/** Scrubs every string in a JSON value; the `shopName` key is replaced outright. */
function scrubJson(value: unknown, replacements: Replacement[], shopName: string): unknown {
  if (typeof value === 'string') return scrubText(value, replacements);
  if (Array.isArray(value)) return value.map((v) => scrubJson(v, replacements, shopName));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === 'shopName' && typeof v === 'string' ? shopName : scrubJson(v, replacements, shopName),
      ]),
    );
  }
  return value;
}

/**
 * What still stands between the shop and deletion (PRD section 25, story 149):
 * - activeRounds: rounds not yet finished in which the shop still holds a live participation;
 * - openPickups: the shop's pickups not yet closed (waiting, ready, out, or awaiting the check);
 * - openClaims: claims submitted and not yet decided;
 * - pendingPayments: payments started and not yet paid, failed or voided;
 * - balanceSen: the money still held for the shop, which the owner must withdraw first.
 */
export async function deletionBlockers(
  tx: Prisma.TransactionClient,
  shopId: string,
): Promise<DeletionBlockers> {
  const [rounds, openPickups, openClaims, pendingPayments, balanceSen] = await Promise.all([
    tx.participation.findMany({
      where: {
        shopId,
        status: { notIn: [...SETTLED_PARTICIPATIONS] },
        round: { status: { notIn: [...FINISHED_ROUNDS] } },
      },
      distinct: ['roundId'],
      select: { roundId: true },
    }),
    tx.pickup.count({ where: { shopId, status: { not: 'closed' } } }),
    tx.claim.count({ where: { shopId, status: 'submitted' } }),
    tx.payment.count({ where: { shopId, status: 'pending' } }),
    balanceOf(tx, { kind: 'shop_balance', shopId }),
  ]);
  return {
    activeRounds: rounds.length,
    openPickups,
    openClaims,
    pendingPayments,
    balanceSen,
  };
}

const canApprove = (b: DeletionBlockers) =>
  b.activeRounds === 0 &&
  b.openPickups === 0 &&
  b.openClaims === 0 &&
  b.pendingPayments === 0 &&
  b.balanceSen === 0;

/**
 * What Ops sees on a pending deletion request: the blockers as they are now, and whether it can be
 * approved now. The stored evidence stays the snapshot taken at request time (`atRequest`).
 */
export async function liveDeletionEvidence(
  db: Prisma.TransactionClient,
  request: ApprovalRequest,
): Promise<Prisma.InputJsonValue> {
  const blockers = await deletionBlockers(db, request.subjectId);
  return {
    ...blockers,
    canApprove: canApprove(blockers),
    atRequest: request.evidence as Prisma.InputJsonValue,
  };
}

/**
 * The owner asks for the shop's data to be deleted. It becomes an Ops approval of type
 * "data deletion" carrying the blockers as evidence. One request at a time (409); a shop that is
 * already anonymised cannot ask again (409).
 */
export async function requestDeletion(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  input: { reason?: string },
): Promise<DeletionRequestResult> {
  if (!UUID.test(shopId)) throw notFound('Shop');
  requireShopAccess(caller, shopId, ['owner']);
  const reason = input.reason?.trim() || undefined;
  return withTransaction(deps, caller, async (ctx) => {
    const { tx } = ctx;
    await lockShop(ctx, shopId);
    const shop = await tx.shop.findUniqueOrThrow({ where: { id: shopId } });
    if (shop.anonymisedAt) {
      throw conflict('SHOP_ANONYMISED', 'This shop has already been deleted.');
    }
    const pending = await tx.approvalRequest.count({
      where: { type: 'data_deletion', shopId, status: 'pending' },
    });
    if (pending > 0) {
      throw conflict(
        'DELETION_ALREADY_REQUESTED',
        'A deletion request for this shop is already waiting for a decision.',
      );
    }
    const blockers = await deletionBlockers(tx, shopId);
    const ready = canApprove(blockers);
    const { id } = await createApproval(ctx, {
      type: 'data_deletion',
      subjectType: 'shop',
      subjectId: shopId,
      shopId,
      assigneeRole: 'ops',
      summary: `Delete the data of ${shop.name}`,
      whyNeeded:
        reason ??
        'The owner asked for the shop and its people to be anonymised. Money records are kept.',
      evidence: { ...blockers, canApprove: ready },
    });
    await appendLog(ctx, {
      action: 'data.deletion_requested',
      subjectType: 'shop',
      subjectId: shopId,
      scope: { shopId },
      after: { approvalId: id },
    });
    return { approvalId: id, ...blockers, canApprove: ready };
  });
}

/**
 * Ops approves: re-check the blockers (422 DELETION_BLOCKED with the counts rolls everything
 * back), then anonymise. Payments, participations, postings and the log are not touched. The
 * stored photo files are removed after the commit by `purgeDeletedPhotos`.
 */
export async function approveDeletion(ctx: TxContext, request: ApprovalRequest): Promise<void> {
  const { tx, now } = ctx;
  const shopId = request.subjectId;
  await lockShop(ctx, shopId);
  const shop = await tx.shop.findUniqueOrThrow({ where: { id: shopId } });
  if (shop.anonymisedAt) {
    throw conflict('SHOP_ANONYMISED', 'This shop has already been deleted.');
  }
  const blockers = await deletionBlockers(tx, shopId);
  if (!canApprove(blockers)) {
    throw unprocessable(
      'DELETION_BLOCKED',
      'The shop still has open rounds, pickups, claims or payments, or a balance to withdraw.',
      blockers,
    );
  }

  const anonymousName = `Deleted shop ${shopId.slice(0, 8)}`;
  await tx.shop.update({
    where: { id: shopId },
    data: {
      name: anonymousName,
      address: '',
      state: '',
      postcode: '',
      lat: 0,
      lng: 0,
      anonymisedAt: now,
    },
  });

  // End the memberships, then anonymise the people who have no other active membership.
  const people = await tx.membership.findMany({ where: { shopId }, select: { userId: true } });
  await tx.membership.updateMany({ where: { shopId, endedAt: null }, data: { endedAt: now } });
  const userIds = [...new Set(people.map((m) => m.userId))];
  const stillMembers = await tx.membership.findMany({
    where: { userId: { in: userIds }, endedAt: null },
    select: { userId: true },
  });
  const keep = new Set(stillMembers.map((m) => m.userId));
  const anonymised = userIds.filter((id) => !keep.has(id));
  const oldUsers = await tx.user.findMany({
    where: { id: { in: anonymised } },
    select: { displayName: true },
  });
  await tx.user.updateMany({
    where: { id: { in: anonymised } },
    data: { displayName: ANONYMOUS_USER, email: null, phone: null, signInProvider: null },
  });

  // Personal and shop-scoped working data. Money records (payments, participations, baskets,
  // postings, withdrawals) and the log stay.
  await tx.notification.deleteMany({
    where: { OR: [{ shopId }, { userId: { in: anonymised } }] },
  });
  await tx.usualListItem.deleteMany({ where: { usualList: { shopId } } });
  await tx.usualList.deleteMany({ where: { shopId } });
  await tx.autoApproveRule.deleteMany({ where: { shopId } });
  await tx.aiSuggestionRun.deleteMany({ where: { shopId } });
  // Delivery and claim photos are marked now; the files go after the commit.
  await tx.photo.updateMany({
    where: { pickup: { shopId }, deletedAt: null },
    data: { deletedAt: now },
  });
  // Approval texts of this shop carry its name; swap it for the anonymous one.
  const scrub: Replacement[] = [
    [shop.name, anonymousName],
    ...oldUsers.map((u): Replacement => [u.displayName, ANONYMOUS_USER]),
  ];
  const approvals = await tx.approvalRequest.findMany({ where: { shopId } });
  for (const a of approvals) {
    const summary = scrubText(a.summary, scrub);
    const whyNeeded = scrubText(a.whyNeeded, scrub);
    const evidence = scrubJson(a.evidence, scrub, anonymousName);
    if (
      summary !== a.summary ||
      whyNeeded !== a.whyNeeded ||
      JSON.stringify(evidence) !== JSON.stringify(a.evidence)
    ) {
      await tx.approvalRequest.update({
        where: { id: a.id },
        data: { summary, whyNeeded, evidence: evidence as Prisma.InputJsonValue },
      });
    }
  }

  // Notifications kept for other people (an Ops claim notice, say) can name the shop or its
  // people in their text; scrub those too.
  const names = [...new Set(scrub.map(([from]) => from).filter((n) => n.trim()))];
  if (names.length > 0) {
    const mentions = await tx.notification.findMany({
      where: {
        OR: names.flatMap((n) => [
          { title: { contains: n } },
          { body: { contains: n } },
          { whatsappText: { contains: n } },
        ]),
      },
      select: { id: true, title: true, body: true, whatsappText: true },
    });
    for (const n of mentions) {
      const data = {
        title: scrubText(n.title, scrub),
        body: scrubText(n.body, scrub),
        whatsappText: scrubText(n.whatsappText, scrub),
      };
      if (data.title !== n.title || data.body !== n.body || data.whatsappText !== n.whatsappText) {
        await tx.notification.update({ where: { id: n.id }, data });
      }
    }
  }

  await appendLog(ctx, {
    action: 'shop.anonymised',
    subjectType: 'shop',
    subjectId: shopId,
    scope: { shopId },
    after: { approvalId: request.id, anonymisedUserCount: anonymised.length },
  });
}

/** Reject: the reason is required (checked by the caller) and goes to the owner. */
export async function rejectDeletion(
  ctx: TxContext,
  request: ApprovalRequest,
  input: DecisionInput,
): Promise<void> {
  const reason = input.reason?.trim();
  if (!reason) throw unprocessable('REASON_REQUIRED', 'Please give a reason for rejecting.');
  await notify(ctx, {
    type: 'deletion.decided',
    audience: { shopId: request.subjectId, roles: ['owner'] },
    link: '/owner/settings',
    message: TEMPLATES['deletion.decided']({ reason }),
    dedupeKey: `deletion.decided:${request.id}`,
  });
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'unknown error');

const SWEEP_BATCH = 100;

/**
 * Removes the stored file of each photo (deleting a missing object is a no-op) and records the
 * time on the row, so it is never handled again. A failure leaves the row unmarked for the sweep.
 */
async function purgePhotos(deps: AppDeps, photos: { id: string; storageKey: string }[]) {
  let purged = 0;
  for (const { id, storageKey } of photos) {
    try {
      await deps.storage.deleteObject('delivery-photos', storageKey);
      const now = (await resolveClock(deps)).now();
      await deps.prisma.photo.update({ where: { id }, data: { storagePurgedAt: now } });
      purged++;
    } catch (error) {
      console.error('Could not delete a stored photo:', errorText(error));
    }
  }
  return purged;
}

/**
 * After the approval has committed, removes the stored files of the photos it marked deleted and
 * records `storagePurgedAt`. It never throws: the approval has already committed, and the due-jobs
 * sweep retries every photo left unmarked.
 */
export async function purgeDeletedPhotos(deps: AppDeps, shopId: string): Promise<void> {
  try {
    const photos = await deps.prisma.photo.findMany({
      where: { pickup: { shopId }, deletedAt: { not: null }, storagePurgedAt: null },
      select: { id: true, storageKey: true },
    });
    await purgePhotos(deps, photos);
  } catch (error) {
    console.error('Could not purge deleted photos:', errorText(error));
  }
}

/**
 * Due-jobs sweep: handles photos marked deleted whose file removal is not yet recorded (oldest
 * first, one batch per run, no age cap). Rows with `storagePurgedAt` are never looked at again.
 * Idempotent; returns how many it purged.
 */
export async function sweepDeletedPhotos(deps: AppDeps): Promise<{ removed: number }> {
  const photos = await deps.prisma.photo.findMany({
    where: { deletedAt: { not: null }, storagePurgedAt: null },
    orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, storageKey: true },
    take: SWEEP_BATCH,
  });
  return { removed: await purgePhotos(deps, photos) };
}
