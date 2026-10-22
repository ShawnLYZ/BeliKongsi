import { z } from 'zod';
import { sessionView, switchMembership } from '@/server/modules/identity/identity';
import { json, route } from '@/server/platform/http';
import { sessionCookieHeader } from '@/server/platform/session';

export const dynamic = 'force-dynamic';

const body = z
  .object({ membershipId: z.uuid().optional(), userId: z.uuid().optional() })
  .refine((v) => (v.membershipId === undefined) !== (v.userId === undefined), {
    message: 'Send exactly one of membershipId and userId.',
  });

export const POST = route({ auth: 'session', body }, async ({ deps, caller, body: input }) => {
  const { session, cookieValue } = await switchMembership(deps, caller, input);
  return json(await sessionView(deps, session), {
    headers: { 'Set-Cookie': sessionCookieHeader(cookieValue) },
  });
});
