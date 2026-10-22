import { z } from 'zod';
import { joinRound } from '@/server/modules/payments/join';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = z.object({
  quantity: z.number().int().min(1).max(100_000),
  priceLimitSen: z.number().int().min(1).nullable().optional(),
  destination: z
    .union([
      z.object({ type: z.literal('door') }),
      z.object({ type: z.literal('pickup_point'), pickupPointId: z.string().regex(UUID) }),
    ])
    .optional(),
});

// Owners join a round from the catalogue; the answer is a pending payment to settle at checkout.
export const POST = route(
  { auth: 'session', body, idempotent: true },
  async ({ deps, caller, params, body: input }) =>
    json(
      await joinRound(deps, caller, params.roundId!, {
        quantity: input.quantity,
        ...(input.priceLimitSen !== undefined ? { priceLimitSen: input.priceLimitSen } : {}),
        ...(input.destination ? { destination: input.destination } : {}),
      }),
    ),
);
