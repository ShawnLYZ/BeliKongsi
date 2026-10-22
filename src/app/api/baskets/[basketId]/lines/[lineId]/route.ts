import { z } from 'zod';
import { changeBasketLine } from '@/server/modules/baskets/basket';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  quantity: z.number().optional(),
  priceLimitSen: z.number().nullable().optional(),
  removed: z.boolean().optional(),
});

// Staff may send only `quantity`; the module answers 403 for the rest.
export const PATCH = route(
  { auth: 'session', body },
  async ({ deps, caller, params, body: input }) =>
    json(await changeBasketLine(deps, caller, params.basketId!, params.lineId!, input)),
);
