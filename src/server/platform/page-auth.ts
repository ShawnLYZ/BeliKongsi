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

/** For owner pages: the owner's session and shop. Anyone else goes to their own home. */
export function requireOwnerShop(session: Session | null): { session: Session; shopId: string } {
  const owner = requirePageRole(session, ['owner']);
  const shopId = owner.membership.shopId;
  if (!shopId) redirect('/sign-in');
  return { session: owner, shopId };
}

/** For supplier pages: the supplier's session and supplier id. Anyone else goes to their own home. */
export function requireSupplierPage(session: Session | null): {
  session: Session;
  supplierId: string;
} {
  const supplier = requirePageRole(session, ['supplier']);
  const supplierId = supplier.membership.supplierId;
  if (!supplierId) redirect('/sign-in');
  return { session: supplier, supplierId };
}
