import { z } from 'zod';
import { listShopParticipations } from '@/server/modules/payments/participations';
import { json, route } from '@/server/platform/http';
import { parsePage } from '@/server/platform/pagination';

export const dynamic = 'force-dynamic';

export const GET = route(
  {
    auth: 'session',
    query: z.object({ status: z.enum(['active', 'history']).default('active') }).loose(),
  },
  async ({ deps, caller, params, query, request }) =>
    json(
      await listShopParticipations(deps, caller, params.shopId!, {
        status: query.status,
        ...parsePage(new URL(request.url).searchParams),
      }),
    ),
);
