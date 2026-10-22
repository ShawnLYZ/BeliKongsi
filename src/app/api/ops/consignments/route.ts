import { z } from 'zod';
import { listConsignments } from '@/server/modules/fulfilment/consignments';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const query = z.object({
  status: z
    .enum(['planned', 'dispatched', 'arrived', 'out_for_delivery', 'delivered', 'completed'])
    .optional(),
});

export const GET = route({ auth: ['ops'], query }, async ({ deps, caller, query: q }) =>
  json({ items: await listConsignments(deps, caller, q) }),
);
