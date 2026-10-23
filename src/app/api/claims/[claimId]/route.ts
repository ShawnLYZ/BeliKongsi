import { getClaimForCaller } from '@/server/modules/checks/claims';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// Owners and Ops only; staff and other shops get 404 from the module.
export const GET = route(
  { auth: ['owner', 'staff', 'ops', 'supplier'] },
  async ({ deps, caller, params }) => json(await getClaimForCaller(deps, caller, params.claimId!)),
);
