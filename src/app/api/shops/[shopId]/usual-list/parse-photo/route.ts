import { z } from 'zod';
import { parseUsualListPhoto } from '@/server/modules/usual-list/parse';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.strictObject({ imageBase64: z.string(), mimeType: z.string() });

// A 5 MB photo is about 6.7 MB as base64, so this route takes up to 8 MiB like the price-list route.
// Any signed-in role reaches the module, which answers 403 for everyone but the shop's owner.
export const POST = route(
  { auth: 'session', body, maxBodyBytes: 8 * 1024 * 1024 },
  async ({ deps, caller, params, body: input }) =>
    json(await parseUsualListPhoto(deps, caller, params.shopId!, input)),
);
