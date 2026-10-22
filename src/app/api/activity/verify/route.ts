import { appendLog, verifyLogChain } from '@/server/modules/activity/log';
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
