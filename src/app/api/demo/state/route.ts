import { getDemoState, requireDemoMode } from '@/server/modules/demo/demo';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async ({ deps }) => {
  await requireDemoMode(deps);
  return json(await getDemoState(deps));
});
