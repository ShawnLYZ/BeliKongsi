import { z } from 'zod';
import { listShopPickups } from '@/server/modules/fulfilment/pickups';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const query = z.object({ status: z.enum(['upcoming', 'past']).optional() });

export const GET = route(
  { auth: ['owner', 'staff'], query },
  async ({ deps, caller, params, query: q }) =>
    json(await listShopPickups(deps, caller, params.shopId!, q)),
);
