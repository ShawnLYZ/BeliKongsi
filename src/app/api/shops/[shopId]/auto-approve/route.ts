import { z } from 'zod';
import { getAutoApproveRule, setAutoApproveRule } from '@/server/modules/baskets/auto-approve';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// Shape only: the module checks the cap (422) and the mandate consent (422 MANDATE_REQUIRED).
const body = z.object({
  enabled: z.boolean(),
  capSen: z.number().optional(),
  requireBelowUsual: z.boolean().optional(),
  agreeToMandate: z.boolean().optional(),
});

// Every signed-in role reaches the module, which answers 403 for everyone but the shop's owner.
export const GET = route({ auth: 'session' }, async ({ deps, caller, params }) =>
  json(await getAutoApproveRule(deps, caller, params.shopId!)),
);

export const PUT = route({ auth: 'session', body }, async ({ deps, caller, params, body: input }) =>
  json(await setAutoApproveRule(deps, caller, params.shopId!, input)),
);
