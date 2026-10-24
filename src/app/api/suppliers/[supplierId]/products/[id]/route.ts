import {
  productPatchSchema,
  updateSupplierProduct,
} from '@/server/modules/catalogue/supplier-edit';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const PATCH = route(
  { auth: ['supplier'], body: productPatchSchema },
  async ({ deps, caller, params, body }) =>
    json(await updateSupplierProduct(deps, caller, params.supplierId!, params.id!, body)),
);
