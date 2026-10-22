import { z } from 'zod';
import { listSupplierOrders } from '@/server/modules/supplier-orders/portal';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const query = z.object({
  status: z
    .enum([
      'awaiting_ops',
      'awaiting_supplier',
      'confirmed',
      'dispatched',
      'settled',
      'rejected_by_ops',
      'rejected_by_supplier',
    ])
    .optional(),
});

export const GET = route(
  { auth: ['supplier', 'ops'], query },
  async ({ deps, caller, params, query: q }) =>
    json({ items: await listSupplierOrders(deps, caller, params.supplierId!, q.status) }),
);
