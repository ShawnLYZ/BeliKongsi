import { z } from 'zod';
import { skipBasket } from '@/server/modules/baskets/lifecycle';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// Skip this week: nothing is charged. The reason is optional for baskets.
export const POST = route(
  { auth: 'session', body: z.object({ reason: z.string().max(500).optional() }) },
  async ({ deps, caller, params, body }) =>
    json(await skipBasket(deps, caller, params.basketId!, body)),
);
