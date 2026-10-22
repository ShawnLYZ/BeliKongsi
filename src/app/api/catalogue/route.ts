import { z } from 'zod';
import { searchCatalogue } from '@/server/modules/catalogue/catalogue';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route(
  { auth: 'session', query: z.object({ q: z.string().max(100).optional() }) },
  async ({ deps, caller, query }) =>
    json({ items: await searchCatalogue(deps, caller, query.q ?? null) }),
);
