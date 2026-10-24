import { skipToCutoff } from '@/server/modules/demo/demo';
import { scheduleWebhookDelivery } from '@/server/platform/due-work';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route({ auth: 'session', idempotent: true }, async ({ deps, caller }) => {
  const result = await skipToCutoff(deps, caller);
  // The closes just emitted round.closed: send it to webhook receivers without waiting.
  scheduleWebhookDelivery(deps);
  return json(result);
});
