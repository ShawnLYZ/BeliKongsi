import { getBalanceView } from '@/server/modules/payments/views';
import { json, route } from '@/server/platform/http';
import { parsePage } from '@/server/platform/pagination';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async ({ deps, caller, params, request }) =>
  json(
    await getBalanceView(
      deps,
      caller,
      params.shopId!,
      parsePage(new URL(request.url).searchParams),
    ),
  ),
);
