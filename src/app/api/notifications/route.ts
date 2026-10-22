import { listNotifications } from '@/server/modules/notifications/query';
import { json, route } from '@/server/platform/http';
import { parsePage } from '@/server/platform/pagination';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async ({ deps, caller, request }) =>
  json(await listNotifications(deps, caller, parsePage(new URL(request.url).searchParams))),
);
