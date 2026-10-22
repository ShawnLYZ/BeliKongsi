import type { Role } from '@/generated/prisma/client';
import type { Caller } from './caller';
import { forbidden, notFound } from './errors';

/** Every helper throws an AppError and returns nothing. System callers pass every check. */

export function requireRole(caller: Caller, roles: readonly Role[]): void {
  if (caller.kind === 'system') return;
  if (!roles.includes(caller.session.membership.role)) throw forbidden();
}

/**
 * Owners and staff reach their own shop only; another shop, and any supplier, gets 404 so the
 * shop's existence is not revealed. Ops pass. With `roles`, a role outside the list gets 403.
 */
export function requireShopAccess(caller: Caller, shopId: string, roles?: readonly Role[]): void {
  if (caller.kind === 'system') return;
  const { role, shopId: ownShopId } = caller.session.membership;
  if (role === 'supplier') throw notFound('Shop');
  if ((role === 'owner' || role === 'staff') && ownShopId !== shopId) throw notFound('Shop');
  if (roles && !roles.includes(role)) throw forbidden();
}

/** A supplier reaches its own supplier only (another one gets 404). Ops pass; owners and staff get 403. */
export function requireSupplierAccess(caller: Caller, supplierId: string): void {
  if (caller.kind === 'system') return;
  const { role, supplierId: ownSupplierId } = caller.session.membership;
  if (role === 'ops') return;
  if (role === 'supplier') {
    if (ownSupplierId !== supplierId) throw notFound('Supplier');
    return;
  }
  throw forbidden();
}

export function requireOps(caller: Caller): void {
  requireRole(caller, ['ops']);
}
