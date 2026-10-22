import { cancelParticipation } from '@/server/modules/payments/cancel';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'session' }, async ({ deps, caller, params }) =>
  json(await cancelParticipation(deps, caller, params.id!)),
);
