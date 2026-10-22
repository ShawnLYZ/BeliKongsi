import { z } from 'zod';
import { listSupplierRounds } from '@/server/modules/supplier-orders/portal';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// A supplier sees open rounds only; the status filter exists so the screen can say so.
const query = z.object({ status: z.literal('open').optional() });

export const GET = route({ auth: ['supplier', 'ops'], query }, async ({ deps, caller, params }) =>
  json({ items: await listSupplierRounds(deps, caller, params.supplierId!) }),
);
