import { z } from 'zod';
import { parseUsualListText } from '@/server/modules/usual-list/parse';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.object({ text: z.string(), useSavedExample: z.boolean().optional() });

// Any signed-in role reaches the module, which answers 403 for everyone but the shop's owner.
export const POST = route(
  { auth: 'session', body },
  async ({ deps, caller, params, body: input }) =>
    json(await parseUsualListText(deps, caller, params.shopId!, input)),
);
