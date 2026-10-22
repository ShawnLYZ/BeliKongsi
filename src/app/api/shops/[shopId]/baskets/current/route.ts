import { getCurrentBasket } from '@/server/modules/baskets/basket';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// Owners get prices and savings; staff get quantities only. Both are decided in the module.
export const GET = route({ auth: 'session' }, async ({ deps, caller, params }) =>
  json(await getCurrentBasket(deps, caller, params.shopId!)),
);
