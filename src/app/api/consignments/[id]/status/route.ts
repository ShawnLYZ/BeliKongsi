import { z } from 'zod';
import { updateConsignmentStatus } from '@/server/modules/fulfilment/consignments';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  status: z.enum(['dispatched', 'arrived', 'out_for_delivery', 'delivered']),
});

export const POST = route(
  { auth: ['ops'], body, idempotent: true },
  async ({ deps, caller, params, body: input }) =>
    json(await updateConsignmentStatus(deps, caller, params.id!, input.status)),
);
