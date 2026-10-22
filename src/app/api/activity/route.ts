import { queryLog } from '@/server/modules/activity/query';
import { json, route } from '@/server/platform/http';
import { parsePage } from '@/server/platform/pagination';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async ({ deps, caller, request }) => {
  const params = new URL(request.url).searchParams;
  const subjectType = params.get('subjectType');
  const subjectId = params.get('subjectId');
  return json(
    await queryLog(deps, caller, {
      ...(subjectType ? { subjectType } : {}),
      ...(subjectId ? { subjectId } : {}),
      ...parsePage(params),
    }),
  );
});
