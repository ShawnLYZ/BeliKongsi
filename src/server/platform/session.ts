import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OrgType, PrismaClient, Role } from '@/generated/prisma/client';
import { systemClock } from '@/server/adapters/clock';
import type { AppDeps } from './deps';

export type Session = {
  userId: string;
  displayName: string;
  membership: {
    id: string;
    role: Role;
    orgType: OrgType;
    orgId: string;
    orgName: string;
    shopId?: string;
    supplierId?: string;
    operatorId?: string;
  };
};

export const SESSION_COOKIE = 'bk_session';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** `iat` is whole seconds since the Unix epoch, taken from the real clock (systemClock). */
export type SessionPayload = { u: string; m: string; iat: number };

const mac = (data: string, secret: string) =>
  createHmac('sha256', secret).update(data).digest('base64url');

export function signSessionValue(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body, secret)}`;
}

export function verifySessionValue(value: string, secret: string): SessionPayload | null {
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof data !== 'object' || data === null) return null;
    const { u, m, iat } = data as Record<string, unknown>;
    if (typeof u !== 'string' || typeof m !== 'string' || typeof iat !== 'number') return null;
    return { u, m, iat };
  } catch {
    return null;
  }
}

export function newSessionValue(deps: AppDeps, session: Session): string {
  return signSessionValue(
    {
      u: session.userId,
      m: session.membership.id,
      iat: Math.floor(systemClock.now().getTime() / 1000),
    },
    deps.env.SESSION_SECRET,
  );
}

function cookieAttributes(maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export const sessionCookieHeader = (value: string): string =>
  `${SESSION_COOKIE}=${value}; ${cookieAttributes(SESSION_MAX_AGE_SECONDS)}`;

export const clearedSessionCookieHeader = (): string =>
  `${SESSION_COOKIE}=; ${cookieAttributes(0)}`;

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Builds the session for one active membership of one user; null if either is gone or ended. */
export async function sessionForMembership(
  prisma: PrismaClient,
  membershipId: string,
  userId?: string,
): Promise<Session | null> {
  const m = await prisma.membership.findFirst({
    where: { id: membershipId, endedAt: null, ...(userId ? { userId } : {}) },
    include: { user: true, shop: true, supplier: true, operator: true },
  });
  if (!m) return null;
  const orgId = m.shopId ?? m.supplierId ?? m.operatorId;
  const orgName = m.shop?.name ?? m.supplier?.name ?? m.operator?.name;
  if (!orgId || !orgName) return null;
  const membership: Session['membership'] = {
    id: m.id,
    role: m.role,
    orgType: m.orgType,
    orgId,
    orgName,
  };
  if (m.shopId) membership.shopId = m.shopId;
  if (m.supplierId) membership.supplierId = m.supplierId;
  if (m.operatorId) membership.operatorId = m.operatorId;
  return { userId: m.userId, displayName: m.user.displayName, membership };
}

/** Resolves a cookie value to a session. User and membership are re-read on every call. */
export async function sessionFromCookieValue(
  deps: AppDeps,
  value: string | null,
): Promise<Session | null> {
  if (!value) return null;
  const payload = verifySessionValue(value, deps.env.SESSION_SECRET);
  if (!payload) return null;
  const nowSeconds = Math.floor(systemClock.now().getTime() / 1000);
  if (payload.iat > nowSeconds + 60 || nowSeconds - payload.iat > SESSION_MAX_AGE_SECONDS) {
    return null;
  }
  return sessionForMembership(deps.prisma, payload.m, payload.u);
}

export async function loadSession(deps: AppDeps, request: Request): Promise<Session | null> {
  return sessionFromCookieValue(deps, readCookie(request.headers.get('cookie'), SESSION_COOKIE));
}
