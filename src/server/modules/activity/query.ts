import type { ActorType, Prisma, Role } from '@/generated/prisma/client';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { badRequest } from '@/server/platform/errors';
import { requireOps } from '@/server/platform/permissions';
import { mytDate, mytInstant } from '@/lib/time';
import { UUID } from '@/server/platform/ids';
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

/** Filters shared by the log page, the API and the CSV export. */
export type LogFilters = {
  /** First day, `YYYY-MM-DD` in Malaysia time, inclusive. */
  from?: string;
  /** Last day, `YYYY-MM-DD` in Malaysia time, inclusive. */
  to?: string;
  /** The person who acted (a user id). */
  actorUserId?: string;
  action?: string;
  subjectType?: string;
  subjectId?: string;
};

/** Midnight MYT at the start of a `YYYY-MM-DD` day, or a 400 for anything that is not a real date. */
function dayStart(value: string, name: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const at = mytInstant(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0);
    if (mytDate(at) === value) return at;
  }
  throw badRequest(`"${name}" must be a date written YYYY-MM-DD.`);
}

/** The where-conditions for the filters, to be combined (AND) with a role's visibility rule. */
export function logFilterConditions(filters: LogFilters): Prisma.ActivityLogEntryWhereInput[] {
  const out: Prisma.ActivityLogEntryWhereInput[] = [];
  const range: Prisma.DateTimeFilter = {};
  if (filters.from) range.gte = dayStart(filters.from, 'from');
  if (filters.to) range.lt = new Date(dayStart(filters.to, 'to').getTime() + 86_400_000);
  if (range.gte || range.lt) out.push({ occurredAt: range });
  if (filters.actorUserId) {
    if (!UUID.test(filters.actorUserId)) throw badRequest('"actorUserId" must be a user id.');
    out.push({ actorUserId: filters.actorUserId });
  }
  if (filters.action) out.push({ action: filters.action });
  if (filters.subjectType) out.push({ subjectType: filters.subjectType });
  if (filters.subjectId) out.push({ subjectId: filters.subjectId });
  return out;
}

/** Reads the filter query parameters; empty values count as absent. */
export function logFiltersFromParams(params: URLSearchParams): LogFilters {
  const out: LogFilters = {};
  for (const key of ['from', 'to', 'actorUserId', 'action', 'subjectType', 'subjectId'] as const) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}

export async function queryLog(
  deps: AppDeps,
  caller: Caller,
  filter: LogFilters & {
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
  // Combined with the visibility rule above (staff are already limited to their own actions).
  const { subjects, subjectType, subjectId, ...rest } = filter;
  if (subjects) where.OR = subjects.map((s) => ({ subjectType: s.type, subjectId: s.id }));
  const conditions = logFilterConditions(subjects ? rest : { ...rest, subjectType, subjectId });
  if (conditions.length) where.AND = conditions;
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

/** Everyone who could appear in the log, by name, for the Ops person filter (Ops only). */
export async function logPeople(
  deps: AppDeps,
  caller: Caller,
): Promise<{ id: string; displayName: string }[]> {
  requireOps(caller);
  return deps.prisma.user.findMany({
    select: { id: true, displayName: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  });
}
