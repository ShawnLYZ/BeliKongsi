import { requireDemoMode } from '@/server/modules/demo/demo';
import { receiveDemoWebhook } from '@/server/modules/integration/webhooks';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'public' }, async ({ request, deps }) => {
  await requireDemoMode(deps);
  return json(await receiveDemoWebhook(deps, request));
});
