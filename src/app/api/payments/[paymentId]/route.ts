import { getPaymentForCaller } from '@/server/modules/payments/views';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async ({ deps, caller, params }) =>
  json(await getPaymentForCaller(deps, caller, params.paymentId!)),
);
