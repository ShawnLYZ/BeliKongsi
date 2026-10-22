import { listEvents } from '@/server/modules/integration/events';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: ['owner', 'supplier', 'ops'] }, async ({ deps, caller }) =>
  json({ items: await listEvents(deps, caller) }),
);
