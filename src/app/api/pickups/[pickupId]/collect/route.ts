import { z } from 'zod';
import { collectPickup } from '@/server/modules/fulfilment/pickups';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// The code as shown ("482 913") or typed ("482913"); the module compares the digits.
const body = z.object({ code: z.string().trim().min(1).max(20) });

export const POST = route(
  { auth: ['owner', 'staff'], body, idempotent: true },
  async ({ deps, caller, params, body: input }) =>
    json(await collectPickup(deps, caller, params.pickupId!, input)),
);
