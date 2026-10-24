import type { ActivityLogEntry, Prisma } from '@/generated/prisma/client';
import { mytDate } from '@/lib/time';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { requireOps } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { toCsv } from '../directory/export';
import { appendLog } from './log';
import { logFilterConditions, type LogFilters } from './query';

const BATCH = 500;

const HEADER = [
  'seq',
  'occurred_at_myt',
  'actor_type',
  'actor_role',
  'actor_name',
  'action',
  'subject_type',
  'subject_id',
  'reason',
  'before_json',
  'after_json',
  'hash',
];

/** `2026-11-02 23:30:00` in Malaysia time (UTC+8, no daylight saving). */
function mytStamp(d: Date): string {
  const myt = new Date(d.getTime() + 8 * 3_600_000);
  return `${myt.toISOString().slice(0, 10)} ${myt.toISOString().slice(11, 19)}`;
}

const json = (v: Prisma.JsonValue | null) => (v === null ? '' : JSON.stringify(v));

/**
 * Text a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab or carriage return first) gets
 * a leading `'` so it shows as plain text. Only the CSV text changes: each row's hash is of the
 * stored entry, so drop the `'` before checking a row against the chain.
 */
function plain(value: string | null): string | null {
  return value !== null && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Every log entry matching the filters as a CSV file (Ops only), oldest first, with each entry's
 * hash so the file can be checked against the chain. The export itself is logged.
 */
export async function exportLogCsv(
  deps: AppDeps,
  caller: Caller,
  filters: LogFilters,
): Promise<{ filename: string; csv: string }> {
  requireOps(caller);
  const where: Prisma.ActivityLogEntryWhereInput = { AND: logFilterConditions(filters) };

  return withTransaction(deps, caller, async (ctx) => {
    const rows: (string | null)[][] = [HEADER];
    let after: bigint | null = null;
    for (;;) {
      const batch: ActivityLogEntry[] = await ctx.tx.activityLogEntry.findMany({
        where: after === null ? where : { AND: [where, { seq: { gt: after } }] },
        orderBy: { seq: 'asc' },
        take: BATCH,
      });
      if (batch.length === 0) break;
      const userIds = [...new Set(batch.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])))];
      const users = userIds.length
        ? await ctx.tx.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, displayName: true },
          })
        : [];
      const names = new Map(users.map((u) => [u.id, u.displayName]));
      for (const r of batch) {
        rows.push(
          [
            r.seq.toString(),
            mytStamp(r.occurredAt),
            r.actorType,
            r.actorRole,
            r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
            r.action,
            r.subjectType,
            r.subjectId,
            r.reason,
            json(r.before),
            json(r.after),
            r.hash,
          ].map(plain),
        );
      }
      after = batch[batch.length - 1]!.seq;
      if (batch.length < BATCH) break;
    }

    await appendLog(ctx, {
      action: 'log.exported',
      subjectType: 'log',
      subjectId: 'activity',
      scope: { operator: true },
      after: {
        filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
        rows: rows.length - 1,
      },
    });
    return { filename: `activity-log-${mytDate(ctx.now)}.csv`, csv: toCsv(rows) };
  });
}
