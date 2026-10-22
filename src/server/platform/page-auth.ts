import { redirect } from 'next/navigation';
import type { Role } from '@/generated/prisma/client';
import { pageRedirectTarget } from '@/lib/roles';
import type { Session } from './session';

/**
 * For server components: sends a visitor without a session to /sign-in, and one whose active role
 * is not in `roles` to their own home. Otherwise returns the session.
 */
export function requirePageRole(session: Session | null, roles: readonly Role[]): Session {
  const target = pageRedirectTarget(session, roles);
  if (target !== null || !session) redirect(target ?? '/sign-in');
  return session;
}
