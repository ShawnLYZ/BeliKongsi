import { z } from 'zod';
import { decideApproval } from '@/server/modules/approvals/approvals';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// The reason is required, but a missing one is a business rule (422), not a malformed request.
const body = z.object({
  reason: z.string().max(1000).optional(),
  note: z.string().max(1000).optional(),
});

export const POST = route(
  { auth: ['supplier', 'ops'], body, idempotent: true },
  async ({ deps, caller, params, body: input }) =>
    json(await decideApproval(deps, caller, params.id!, { decision: 'reject', ...input })),
);
