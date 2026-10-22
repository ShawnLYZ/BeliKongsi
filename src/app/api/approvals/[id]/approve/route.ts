import { z } from 'zod';
import { decideApproval } from '@/server/modules/approvals/approvals';
import { badRequest } from '@/server/platform/errors';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  note: z.string().max(1000).optional(),
  expectedDispatchDate: z.iso.date().optional(),
});

// Both inputs are optional, so a POST with no body is the same as `{}`. The route wrapper
// already bounds the request stream, so reading the text here stays within the body limit.
export const POST = route(
  { auth: ['supplier', 'ops'], idempotent: true },
  async ({ deps, caller, params, request }) => {
    const text = (await request.text()).trim();
    let raw: unknown = {};
    if (text !== '') {
      try {
        raw = JSON.parse(text);
      } catch {
        throw badRequest('The request body must be valid JSON.');
      }
    }
    const parsed = body.safeParse(raw);
    if (!parsed.success) {
      throw badRequest('The request was not valid.', {
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      });
    }
    return json(
      await decideApproval(deps, caller, params.id!, { decision: 'approve', ...parsed.data }),
    );
  },
);
