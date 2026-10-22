import { moneyOverview } from '@/server/modules/ops/money';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: ['ops'] }, async ({ deps, caller }) =>
  json(await moneyOverview(deps, caller)),
);
