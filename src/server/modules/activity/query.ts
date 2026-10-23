import type { ActorType, Prisma, Role } from '@/generated/prisma/client';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { toPage } from '@/server/platform/pagination';
import { relatedSubjects, type Subject } from './related';

export type LogEntryView = {
  seq: string;
  occurredAt: string;
  actorType: ActorType;
  actorRole: Role | null;
  actorName: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  reason: string | null;
};

const MONEY_KEY = /sen|price|amount|total|balance|saving|fee/i;
const MONEY_TEXT = /RM\s?\d+(?:,\d{3})*(?:\.\d+)?/g;
const MASK = 'RM •••';

function maskMoney(text: string): string {
  return text.replace(MONEY_TEXT, MASK);
}

function stripMoney(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (Array.isArray(value)) return value.map((v) => stripMoney(v));
  if (value && typeof value === 'object') {
    const out: Record<string, Prisma.JsonValue | null> = {};
    for (const [k, v] of Object.entries(value)) {
      if (!MONEY_KEY.test(k)) out[k] = stripMoney(v ?? null);
    }
    return out;
  }
  if (typeof value === 'string') return maskMoney(value);
  return value;
}

export async function queryLog(
  deps: AppDeps,
  caller: Caller,
  filter: {
    subjectType?: string;
    subjectId?: string;
    /** Entries about any of these subjects; used instead of `subjectType` and `subjectId`. */
    subjects?: Subject[];
    cursor: string | null;
    limit: number;
  },
): Promise<{ items: LogEntryView[]; nextCursor: string | null }> {
  const where: Prisma.ActivityLogEntryWhereInput = {};
  const redact = caller.kind === 'person' && caller.session.membership.role === 'staff';

  if (caller.kind === 'person') {
    const { role, shopId, supplierId } = caller.session.membership;
    if (role === 'owner') where.shopId = shopId ?? '';
    else if (role === 'staff') where.actorUserId = caller.session.userId;
    else if (role === 'supplier') where.supplierId = supplierId ?? '';
    // ops sees everything
  }
  if (filter.subjects) {
    where.OR = filter.subjects.map((s) => ({ subjectType: s.type, subjectId: s.id }));
  } else {
    if (filter.subjectType) where.subjectType = filter.subjectType;
    if (filter.subjectId) where.subjectId = filter.subjectId;
  }
  if (filter.cursor !== null) {
    if (!/^\d+$/.test(filter.cursor)) return { items: [], nextCursor: null };
    where.seq = { lt: BigInt(filter.cursor) };
  }

  const rows = await deps.prisma.activityLogEntry.findMany({
    where,
    orderBy: { seq: 'desc' },
    take: filter.limit + 1,
  });
  const page = toPage(rows, filter.limit, (r) => r.seq.toString());

  const userIds = [...new Set(page.items.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])))];
  const users = userIds.length
    ? await deps.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.id, u.displayName]));

  return {
    items: page.items.map((r) => ({
      seq: r.seq.toString(),
      occurredAt: r.occurredAt.toISOString(),
      actorType: r.actorType,
      actorRole: r.actorRole,
      actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
      action: r.action,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      before: redact ? stripMoney(r.before) : r.before,
      after: redact ? stripMoney(r.after) : r.after,
      reason: redact && r.reason ? maskMoney(r.reason) : r.reason,
    })),
    nextCursor: page.nextCursor,
  };
}

/**
 * The newest entries about one subject (visibility rules of queryLog apply). Returns the first
 * page; pass `cursor` (a previous `nextCursor`) for older entries. With `related`, the steps
 * logged on the item's pickup, delivery check and claim are included too.
 */
export async function subjectTimeline(
  deps: AppDeps,
  caller: Caller,
  subjectType: string,
  subjectId: string,
  page: { cursor?: string | null; limit?: number; related?: boolean } = {},
): Promise<{ items: LogEntryView[]; nextCursor: string | null }> {
  const subjects = page.related
    ? await relatedSubjects(deps.prisma, subjectType, subjectId)
    : undefined;
  return queryLog(deps, caller, {
    subjectType,
    subjectId,
    ...(subjects ? { subjects } : {}),
    cursor: page.cursor ?? null,
    limit: page.limit ?? 50,
  });
}
