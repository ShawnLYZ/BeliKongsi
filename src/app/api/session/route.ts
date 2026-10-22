import { z } from 'zod';
import { sessionView, signIn } from '@/server/modules/identity/identity';
import { json, route } from '@/server/platform/http';
import { clearedSessionCookieHeader, sessionCookieHeader } from '@/server/platform/session';

export const dynamic = 'force-dynamic';

const signInBody = z.object({
  userId: z.uuid(),
  provider: z.enum(['microsoft', 'google']),
});

export const GET = route({ auth: 'session' }, async ({ deps, session }) =>
  json(await sessionView(deps, session)),
);

export const POST = route({ auth: 'public', body: signInBody }, async ({ deps, request, body }) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { session, cookieValue } = await signIn(deps, body, ip);
  return json(await sessionView(deps, session), {
    headers: { 'Set-Cookie': sessionCookieHeader(cookieValue) },
  });
});

export const DELETE = route({ auth: 'public' }, async () =>
  json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookieHeader() } }),
);
