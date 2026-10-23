import { appendLog, verifyLogChain } from '@/server/modules/activity/log';
import { recentLogCheck } from '@/server/modules/activity/verify-cache';
import { json, route } from '@/server/platform/http';
import { withTransaction } from '@/server/platform/tx';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: ['ops'] }, async ({ deps, caller }) => {
  // The result describes the chain before this check's own entry is added.
  const result = await verifyLogChain(deps.prisma);
  await withTransaction(deps, caller, (ctx) =>
    appendLog(ctx, {
      action: 'log.verified',
      subjectType: 'activity_log',
      subjectId: 'chain',
      scope: { operator: true },
      after: result,
    }),
  );
  return json(result);
});

/**
 * The check without a log entry, for owners' timelines. Owners only learn whether the log is
 * intact; the entry count and first broken entry stay with Ops.
 */
export const GET = route({ auth: ['owner', 'ops'] }, async ({ deps, caller }) => {
  const result = await recentLogCheck(deps);
  const ops = caller.kind === 'person' && caller.session.membership.role === 'ops';
  return json(ops ? result : { valid: result.valid });
});
