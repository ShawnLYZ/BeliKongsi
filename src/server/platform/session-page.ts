import { cache } from 'react';
import { cookies } from 'next/headers';
import { getDeps } from './deps';
import { SESSION_COOKIE, sessionFromCookieValue, type Session } from './session';

/**
 * For server components only. Route handlers get their session from the route wrapper.
 * Cached per request, so the shell layout and its page share one lookup.
 */
export const getPageSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  return sessionFromCookieValue(getDeps(), store.get(SESSION_COOKIE)?.value ?? null);
});
