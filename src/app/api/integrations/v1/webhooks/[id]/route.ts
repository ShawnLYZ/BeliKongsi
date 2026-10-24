import { deleteWebhook, requireAppId } from '@/server/modules/integration/webhooks';
import { scheduleWebhookDelivery } from '@/server/platform/due-work';
import { route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const DELETE = route({ auth: 'public' }, async ({ request, deps, params }) => {
  const appId = requireAppId(request);
  await deleteWebhook(deps, appId, params.id ?? '');
  scheduleWebhookDelivery(deps);
  return new Response(null, { status: 204 });
});
