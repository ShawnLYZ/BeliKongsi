import { z } from 'zod';
import { listPendingApprovals } from '@/server/modules/approvals/approvals';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const query = z.object({ status: z.literal('pending').optional() });

export const GET = route({ auth: ['owner', 'supplier', 'ops'], query }, async ({ deps, caller }) =>
  json({ items: await listPendingApprovals(deps, caller) }),
);
