import { z } from 'zod';
import { simulatePaymentResult } from '@/server/modules/payments/simulate';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  outcome: z.enum(['succeeded', 'failed']),
  method: z.enum(['duitnow_qr', 'fpx']),
});

export const POST = route(
  { auth: 'session', body },
  async ({ deps, caller, params, body: result }) =>
    json(await simulatePaymentResult(deps, caller, params.paymentId!, result)),
);
