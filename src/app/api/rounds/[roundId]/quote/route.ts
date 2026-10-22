import { z } from 'zod';
import { quoteForShop, type DestinationInput } from '@/server/modules/rounds/quote';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `door` or `pickup:<id>`. */
const destination = z
  .string()
  .refine((s) => s === 'door' || (s.startsWith('pickup:') && UUID.test(s.slice(7))), {
    message: 'Use destination=door or destination=pickup:<id>.',
  })
  .transform((s): DestinationInput =>
    s === 'door' ? { type: 'door' } : { type: 'pickup_point', pickupPointId: s.slice(7) },
  );

const query = z.object({
  quantity: z.coerce.number().int().min(1).max(100_000),
  destination: destination.optional(),
  priceLimitSen: z.coerce.number().int().min(1).optional(),
});

export const GET = route({ auth: 'session', query }, async ({ deps, caller, params, query: q }) =>
  json(
    await quoteForShop(deps, caller, params.roundId!, {
      quantity: q.quantity,
      ...(q.destination ? { destination: q.destination } : {}),
      ...(q.priceLimitSen !== undefined ? { priceLimitSen: q.priceLimitSen } : {}),
    }),
  ),
);
