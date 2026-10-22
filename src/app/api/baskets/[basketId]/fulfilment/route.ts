import { z } from 'zod';
import { setBasketFulfilment } from '@/server/modules/baskets/basket';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.discriminatedUnion('fulfilment', [
  z.object({ fulfilment: z.literal('pickup'), pickupPointId: z.uuid() }),
  z.object({ fulfilment: z.literal('door') }),
]);

export const PATCH = route(
  { auth: 'session', body },
  async ({ deps, caller, params, body: input }) =>
    json(await setBasketFulfilment(deps, caller, params.basketId!, input)),
);
