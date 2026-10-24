import { confirmPriceList, priceListConfirmSchema } from '@/server/modules/catalogue/price-list';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const POST = route(
  { auth: ['supplier'], body: priceListConfirmSchema },
  async ({ deps, caller, params, body }) =>
    json(await confirmPriceList(deps, caller, params.supplierId!, body)),
);
