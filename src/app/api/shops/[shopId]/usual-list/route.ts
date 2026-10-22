import { z } from 'zod';
import { getUsualList, saveUsualList } from '@/server/modules/usual-list/usual-list';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// Shape only: the module checks ranges (400) and the price limit (422).
const body = z.object({
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number(),
        usualPriceSen: z.number().nullable(),
        priceLimitSen: z.number().nullable().optional(),
      }),
    )
    .max(500),
  suggestionRunId: z.uuid().optional(),
});

// Any signed-in role reaches the module, which answers 403 for everyone but the shop's owner.
// Before the first save the answer is 200 with `{ list: null }`.
export const GET = route({ auth: 'session' }, async ({ deps, caller, params }) =>
  json({ list: await getUsualList(deps, caller, params.shopId!) }),
);

export const PUT = route({ auth: 'session', body }, async ({ deps, caller, params, body: input }) =>
  json(await saveUsualList(deps, caller, params.shopId!, input)),
);
