import type { SignInProvider } from '@/generated/prisma/client';
import { personCaller, type Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { forbidden, notFound } from '@/server/platform/errors';
import { enforceRateLimit } from '@/server/platform/rate-limit';
import { newSessionValue, sessionForMembership, type Session } from '@/server/platform/session';
import { withTransaction } from '@/server/platform/tx';
import { appendLog } from '@/server/modules/activity/log';

const SIGN_IN_LIMIT = 20;
const SIGN_IN_WINDOW_MS = 10 * 60 * 1000;

type Scope = { shopId?: string; supplierId?: string; operator?: boolean };

function scopeOf(session: Session): Scope {
  const { shopId, supplierId, operatorId } = session.membership;
  if (shopId) return { shopId };
  if (supplierId) return { supplierId };
  return operatorId ? { operator: true } : {};
}

export type SignInAccount = {
  userId: string;
  displayName: string;
  role: Session['membership']['role'];
  orgType: Session['membership']['orgType'];
  orgName: string;
};

/** Every seeded person with an active membership: the simulated Orbyte account picker. */
export async function listSignInAccounts(deps: AppDeps): Promise<SignInAccount[]> {
  const rows = await deps.prisma.membership.findMany({
    where: { endedAt: null },
    include: { user: true, shop: true, supplier: true, operator: true },
    orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
  });
  return rows.map((m) => ({
    userId: m.userId,
    displayName: m.user.displayName,
    role: m.role,
    orgType: m.orgType,
    orgName: m.shop?.name ?? m.supplier?.name ?? m.operator?.name ?? '',
  }));
}

async function activeMembershipIdOf(deps: AppDeps, userId: string): Promise<string | null> {
  const m = await deps.prisma.membership.findFirst({
    where: { userId, endedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return m?.id ?? null;
}

/** Signs in as a seeded person (no password). Returns the session and its signed cookie value. */
export async function signIn(
  deps: AppDeps,
  input: { userId: string; provider: SignInProvider },
  ip: string,
): Promise<{ session: Session; cookieValue: string }> {
  await enforceRateLimit(deps, `signin:${ip}`, SIGN_IN_LIMIT, SIGN_IN_WINDOW_MS);
  const membershipId = await activeMembershipIdOf(deps, input.userId);
  const session = membershipId
    ? await sessionForMembership(deps.prisma, membershipId, input.userId)
    : null;
  if (!session) throw notFound('That account');

  await withTransaction(deps, personCaller(session), (ctx) =>
    appendLog(ctx, {
      action: 'shell.signed_in',
      subjectType: 'user',
      subjectId: session.userId,
      scope: scopeOf(session),
      after: { membershipId: session.membership.id, provider: input.provider },
    }),
  );
  return { session, cookieValue: newSessionValue(deps, session) };
}

/**
 * Changes the active membership. `membershipId` must be one of the caller's own active ones.
 * `userId` (sign in as another seeded person) works only in demo mode (C6); outside it the
 * answer is a plain 404, the same as for an unknown id.
 */
export async function switchMembership(
  deps: AppDeps,
  caller: Caller,
  input: { membershipId?: string; userId?: string },
): Promise<{ session: Session; cookieValue: string }> {
  if (caller.kind !== 'person') throw forbidden();
  const current = caller.session;

  let target: Session | null = null;
  if (input.membershipId) {
    target = await sessionForMembership(deps.prisma, input.membershipId, current.userId);
  } else if (input.userId) {
    const settings = await deps.prisma.demoSettings.findUnique({ where: { id: 1 } });
    if (settings?.demoMode) {
      const id = await activeMembershipIdOf(deps, input.userId);
      target = id ? await sessionForMembership(deps.prisma, id, input.userId) : null;
    }
  }
  if (!target) throw notFound('That membership');
  const next = target;

  await withTransaction(deps, caller, (ctx) =>
    appendLog(ctx, {
      action: 'shell.role_switched',
      subjectType: 'membership',
      subjectId: next.membership.id,
      scope: scopeOf(next),
      before: { membershipId: current.membership.id, userId: current.userId },
      after: { membershipId: next.membership.id, userId: next.userId },
    }),
  );
  return { session: next, cookieValue: newSessionValue(deps, next) };
}

/** The JSON the shell receives: who is signed in and which businesses they can switch to. */
export async function sessionView(deps: AppDeps, session: Session) {
  const rows = await deps.prisma.membership.findMany({
    where: { userId: session.userId, endedAt: null },
    include: { shop: true, supplier: true, operator: true },
    orderBy: { id: 'asc' },
  });
  const describe = (m: Session['membership']) => ({
    id: m.id,
    role: m.role,
    orgType: m.orgType,
    orgId: m.orgId,
    orgName: m.orgName,
  });
  return {
    user: { id: session.userId, displayName: session.displayName },
    activeMembership: describe(session.membership),
    memberships: rows.map((m) => ({
      id: m.id,
      role: m.role,
      orgType: m.orgType,
      orgId: (m.shopId ?? m.supplierId ?? m.operatorId) as string,
      orgName: m.shop?.name ?? m.supplier?.name ?? m.operator?.name ?? '',
    })),
  };
}
