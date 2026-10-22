import { approveBasket } from '@/server/modules/baskets/approve';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// "Approve & pay": a repeated tap with the same Idempotency-Key replays the first answer, and
// a basket already waiting for its payment returns that payment either way.
export const POST = route({ auth: 'session', idempotent: true }, async ({ deps, caller, params }) =>
  json(await approveBasket(deps, caller, params.basketId!)),
);
