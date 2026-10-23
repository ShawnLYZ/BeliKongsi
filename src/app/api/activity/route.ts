import { queryLog, subjectTimeline } from '@/server/modules/activity/query';
import { json, route } from '@/server/platform/http';
import { parsePage } from '@/server/platform/pagination';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async ({ deps, caller, request }) => {
  const params = new URL(request.url).searchParams;
  const subjectType = params.get('subjectType');
  const subjectId = params.get('subjectId');
  const page = parsePage(params);
  // `related=1` turns the subject's entries into its whole timeline (its pickup, check and claim too).
  if (subjectType && subjectId && params.get('related') === '1') {
    return json(
      await subjectTimeline(deps, caller, subjectType, subjectId, { ...page, related: true }),
    );
  }
  return json(
    await queryLog(deps, caller, {
      ...(subjectType ? { subjectType } : {}),
      ...(subjectId ? { subjectId } : {}),
      ...page,
    }),
  );
});
