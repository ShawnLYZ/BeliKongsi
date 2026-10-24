import { cancelLateItem } from '@/server/modules/fulfilment/late-cancel';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// A repeated tap with the same Idempotency-Key replays the first answer instead of refunding twice.
export const POST = route({ auth: 'session', idempotent: true }, async ({ deps, caller, params }) =>
  json(await cancelLateItem(deps, caller, params.id!)),
);
