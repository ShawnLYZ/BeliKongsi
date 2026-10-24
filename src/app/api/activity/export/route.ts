import { exportLogCsv } from '@/server/modules/activity/export';
import { logFiltersFromParams } from '@/server/modules/activity/query';
import { route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: ['ops'] }, async ({ deps, caller, request }) => {
  const filters = logFiltersFromParams(new URL(request.url).searchParams);
  const { filename, csv } = await exportLogCsv(deps, caller, filters);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
});
