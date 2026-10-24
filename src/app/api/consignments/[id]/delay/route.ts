import { z } from 'zod';
import { setNewDate } from '@/server/modules/fulfilment/late';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// A missing reason is the service's 422 `REASON_REQUIRED`, not a shape error.
const body = z.object({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().optional(),
});

export const POST = route(
  { auth: ['ops'], body, idempotent: true },
  async ({ deps, caller, params, body: input }) => {
    await setNewDate(
      deps,
      caller,
      { consignmentId: params.id! },
      { newDate: input.newDate, reason: input.reason ?? '' },
    );
    return json({ ok: true });
  },
);
