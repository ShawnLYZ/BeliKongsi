import { z } from 'zod';
import { previewHubCheck, recordHubCheck } from '@/server/modules/supplier-orders/hub-check';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  goodUnits: z.number().int().min(0),
  damagedUnits: z.number().int().min(0),
  notes: z.string().max(500).optional(),
});
const query = z.object({ preview: z.enum(['true', 'false']).optional() }).loose();

export const POST = route(
  { auth: ['ops'], body, query, idempotent: true, idempotencyByQuery: true },
  async ({ deps, caller, params, body: input, query: q }) =>
    json(
      q.preview === 'true'
        ? await previewHubCheck(deps, caller, params.id!, input)
        : await recordHubCheck(deps, caller, params.id!, input),
    ),
);
