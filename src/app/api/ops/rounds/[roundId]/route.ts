import { opsRoundDetail } from '@/server/modules/ops/rounds-board';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: ['ops'] }, async ({ deps, caller, params }) =>
  json(await opsRoundDetail(deps, caller, params.roundId!)),
);
