import { z } from 'zod';
import { opsRoundsBoard } from '@/server/modules/ops/rounds-board';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const query = z.object({
  status: z
    .enum([
      'scheduled',
      'open',
      'empty',
      'failed',
      'formed',
      'ordered',
      'confirmed',
      'dispatched',
      'at_hub',
      'completed',
      'cancelled',
    ])
    .optional(),
});

export const GET = route({ auth: ['ops'], query }, async ({ deps, caller, query: q }) =>
  json(await opsRoundsBoard(deps, caller, q)),
);
