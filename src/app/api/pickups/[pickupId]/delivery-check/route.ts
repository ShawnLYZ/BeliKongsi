import { z } from 'zod';
import { submitDeliveryCheck } from '@/server/modules/checks/delivery-check';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const line = z.object({
  allocationId: z.string().max(64),
  missing: z.number().int().min(0).max(100000),
  damaged: z.number().int().min(0).max(100000),
  photoIds: z.array(z.string().max(64)).max(20),
});
// Which collection is checked (P1-8); optional while the pickup has only one unchecked.
const collectionId = z.string().max(64).optional();
const body = z.union([
  z.object({ allReceived: z.literal(true), collectionId }),
  z.object({ lines: z.array(line).min(1).max(100), collectionId }),
]);

export const POST = route(
  { auth: ['owner', 'staff'], body },
  async ({ deps, caller, params, body: input }) =>
    json(await submitDeliveryCheck(deps, caller, params.pickupId!, input)),
);
