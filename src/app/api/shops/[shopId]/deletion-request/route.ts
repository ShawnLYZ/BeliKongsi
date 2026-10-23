import { z } from 'zod';
import { requestDeletion } from '@/server/modules/directory/deletion';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.object({ reason: z.string().max(500).optional() });

export const POST = route(
  { auth: ['owner'], body },
  async ({ deps, caller, params, body: input }) =>
    json(await requestDeletion(deps, caller, params.shopId!, input)),
);
