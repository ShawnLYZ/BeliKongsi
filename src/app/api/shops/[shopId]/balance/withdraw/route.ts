import { z } from 'zod';
import { withdrawBalance } from '@/server/modules/payments/withdraw';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// Shape only: the module checks the amount (422 INVALID_AMOUNT) and that the caller owns the shop.
const body = z.object({ amountSen: z.number() });

// A repeated tap with the same Idempotency-Key replays the first answer instead of paying out twice.
export const POST = route(
  { auth: 'session', idempotent: true, body },
  async ({ deps, caller, params, body: input }) =>
    json(await withdrawBalance(deps, caller, params.shopId!, input)),
);
