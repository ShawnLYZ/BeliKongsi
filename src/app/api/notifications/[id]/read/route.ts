import { markNotificationRead } from '@/server/modules/notifications/query';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'session' }, async ({ deps, caller, params }) => {
  await markNotificationRead(deps, caller, params.id!);
  return json({ ok: true });
});
