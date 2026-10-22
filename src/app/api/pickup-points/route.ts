import { listPickupPointsForShop } from '@/server/modules/directory/directory';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async ({ deps, caller }) =>
  json({ items: await listPickupPointsForShop(deps, caller) }),
);
