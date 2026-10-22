import { z } from 'zod';
import { addBasketLine } from '@/server/modules/baskets/basket';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.object({ productId: z.string(), quantity: z.number() });

// Idempotent: adding a line adds to its quantity, so a retry after a lost answer must not add twice.
export const POST = route(
  { auth: 'session', body, idempotent: true },
  async ({ deps, caller, params, body: input }) =>
    json(await addBasketLine(deps, caller, params.basketId!, input)),
);
