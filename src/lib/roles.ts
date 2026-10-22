import type { OrgType, Role } from '@/generated/prisma/client';

const HOMES: Record<Role, string> = {
  owner: '/owner',
  staff: '/staff',
  supplier: '/supplier',
  ops: '/ops',
};

const LABELS: Record<Role, string> = {
  owner: 'Owner',
  staff: 'Staff',
  supplier: 'Supplier',
  ops: 'Ops',
};

/** The home screen of a role. */
export const homeFor = (role: Role): string => HOMES[role];

export const roleLabel = (role: Role): string => LABELS[role];

/** Owner and staff screens sit in a phone-width column; supplier and Ops screens use the full width. */
export const usesPhoneColumn = (role: Role): boolean => role === 'owner' || role === 'staff';

/**
 * Where a page must send the visitor instead of rendering, or null when they may stay:
 * no session goes to sign-in, a role outside `roles` goes to the visitor's own home.
 */
export function pageRedirectTarget(
  session: { membership: { role: Role } } | null,
  roles: readonly Role[],
): string | null {
  if (!session) return '/sign-in';
  const { role } = session.membership;
  return roles.includes(role) ? null : homeFor(role);
}

export type AccountLike = {
  userId: string;
  displayName: string;
  role: Role;
  orgType: OrgType;
  orgName: string;
};

export type AccountGroup<T extends AccountLike> = {
  orgName: string;
  orgType: OrgType;
  accounts: T[];
};

const ORG_ORDER: Record<OrgType, number> = { shop: 0, supplier: 1, operator: 2 };
const ROLE_ORDER: Record<Role, number> = { owner: 0, staff: 1, supplier: 2, ops: 3 };

/** Seeded accounts grouped by business: shops first, then suppliers, then Ops; owners before staff. */
export function groupAccounts<T extends AccountLike>(accounts: readonly T[]): AccountGroup<T>[] {
  const groups = new Map<string, AccountGroup<T>>();
  for (const a of accounts) {
    const key = `${a.orgType}:${a.orgName}`;
    let g = groups.get(key);
    if (!g) {
      g = { orgName: a.orgName, orgType: a.orgType, accounts: [] };
      groups.set(key, g);
    }
    g.accounts.push(a);
  }
  const sorted = [...groups.values()].sort(
    (x, y) => ORG_ORDER[x.orgType] - ORG_ORDER[y.orgType] || x.orgName.localeCompare(y.orgName),
  );
  for (const g of sorted) {
    g.accounts.sort(
      (x, y) =>
        ROLE_ORDER[x.role] - ROLE_ORDER[y.role] || x.displayName.localeCompare(y.displayName),
    );
  }
  return sorted;
}
