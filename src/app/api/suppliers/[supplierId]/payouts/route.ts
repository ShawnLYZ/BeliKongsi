import { listSupplierPayouts } from '@/server/modules/supplier-orders/portal';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: ['supplier', 'ops'] }, async ({ deps, caller, params }) =>
  json({ items: await listSupplierPayouts(deps, caller, params.supplierId!) }),
);
