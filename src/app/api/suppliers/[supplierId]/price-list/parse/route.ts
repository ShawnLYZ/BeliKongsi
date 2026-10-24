import { parsePriceList, priceListParseSchema } from '@/server/modules/catalogue/price-list';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// A 5 MB photo is about 6.7 MB as base64, so this route takes up to 8 MiB like the photo routes.
export const POST = route(
  { auth: ['supplier'], body: priceListParseSchema, maxBodyBytes: 8 * 1024 * 1024 },
  async ({ deps, caller, params, body }) =>
    json(await parsePriceList(deps, caller, params.supplierId!, body)),
);
