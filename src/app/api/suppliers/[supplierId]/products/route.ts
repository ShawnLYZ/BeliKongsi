import {
  createSupplierProduct,
  productInputSchema,
} from '@/server/modules/catalogue/supplier-edit';
import { listSupplierProducts } from '@/server/modules/supplier-orders/portal';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: ['supplier', 'ops'] }, async ({ deps, caller, params }) =>
  json({ items: await listSupplierProducts(deps, caller, params.supplierId!) }),
);

export const POST = route(
  { auth: ['supplier'], body: productInputSchema },
  async ({ deps, caller, params, body }) =>
    json(await createSupplierProduct(deps, caller, params.supplierId!, body), { status: 201 }),
);
