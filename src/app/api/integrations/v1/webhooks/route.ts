import {
  listWebhooks,
  registerWebhook,
  registerWebhookSchema,
  requireAppId,
} from '@/server/modules/integration/webhooks';
import { scheduleWebhookDelivery } from '@/server/platform/due-work';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'public' }, async ({ request, deps }) => {
  const appId = requireAppId(request);
  return json({ items: await listWebhooks(deps, appId) });
});

export const POST = route(
  { auth: 'public', body: registerWebhookSchema },
  async ({ request, deps, body }) => {
    const appId = requireAppId(request);
    // The app's own origin comes from the request URL, never from a header.
    const created = await registerWebhook(deps, appId, body, new URL(request.url).origin);
    scheduleWebhookDelivery(deps);
    return json(created, { status: 201 });
  },
);
