import { markDispatched } from '@/server/modules/supplier-orders/supplier-decision';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const POST = route(
  { auth: ['supplier'], idempotent: true },
  async ({ deps, caller, params }) => json(await markDispatched(deps, caller, params.id!)),
);
