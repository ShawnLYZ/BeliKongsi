import { z } from 'zod';
import { getShopSettings, updateShopSettings } from '@/server/modules/directory/directory';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.discriminatedUnion('defaultFulfilment', [
  z.object({ defaultFulfilment: z.literal('pickup'), pickupPointId: z.uuid() }),
  z.object({ defaultFulfilment: z.literal('door') }),
]);

export const GET = route({ auth: 'session' }, async ({ deps, caller, params }) =>
  json(await getShopSettings(deps, caller, params.shopId!)),
);

// Every role that belongs to a shop (or Ops) reaches the module, which answers 403 for non-owners.
export const PATCH = route(
  { auth: 'session', body },
  async ({ deps, caller, params, body: input }) =>
    json(await updateShopSettings(deps, caller, params.shopId!, input)),
);
