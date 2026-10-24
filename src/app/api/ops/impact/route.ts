import { impactMetrics } from '@/server/modules/ops/impact';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: ['ops'] }, async ({ deps, caller }) =>
  json(await impactMetrics(deps, caller)),
);
