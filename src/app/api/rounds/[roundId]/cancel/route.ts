import { z } from 'zod';
import { cancelOpenRound } from '@/server/modules/rounds/cancel';
import { scheduleWebhookDelivery } from '@/server/platform/due-work';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// The reason is required, but a missing one is a business rule (422), not a malformed request.
const body = z.object({
  reason: z.string().max(1000).optional(),
  pauseProduct: z.boolean().optional(),
});

export const POST = route(
  { auth: ['ops'], body, idempotent: true },
  async ({ deps, caller, params, body: input }) => {
    const result = await cancelOpenRound(deps, caller, params.roundId!, input);
    // round.cancelled was just emitted: send it to webhook receivers without waiting.
    scheduleWebhookDelivery(deps);
    return json(result);
  },
);
