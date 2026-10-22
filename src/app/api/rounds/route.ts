import { listOpenRounds } from '@/server/modules/rounds/read';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async ({ deps, caller }) =>
  json({ items: await listOpenRounds(deps, caller) }),
);
