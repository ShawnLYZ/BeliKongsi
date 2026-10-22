import { completeOtherRounds } from '@/server/modules/demo/complete-other-rounds';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route({ auth: 'session', idempotent: true }, async ({ deps, caller }) =>
  json(await completeOtherRounds(deps, caller)),
);
