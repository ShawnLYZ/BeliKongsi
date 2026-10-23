import { z } from 'zod';
import { monthlySavings } from '@/server/modules/savings/savings';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route(
  {
    auth: ['owner'],
    query: z
      .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
      .partial()
      .loose(),
  },
  async ({ deps, caller, params, query }) =>
    json(await monthlySavings(deps, caller, params.shopId!, query.month)),
);
