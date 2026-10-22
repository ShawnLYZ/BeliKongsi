import { resolveClock } from '@/server/adapters/clock';
import type { Prisma, Role } from '@/generated/prisma/client';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { forbidden, notFound } from '@/server/platform/errors';
import { toPage } from '@/server/platform/pagination';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NotificationView = {
  id: string;
  role: Role;
  type: string;
  title: string;
  body: string;
  link: string;
  whatsappText: string;
  createdAt: string;
  readAt: string | null;
};

function scopeOf(caller: Caller): Prisma.NotificationWhereInput {
  if (caller.kind !== 'person') throw forbidden();
  const { userId, membership } = caller.session;
  return {
    userId,
    role: membership.role,
    shopId: membership.shopId ?? null,
    supplierId: membership.supplierId ?? null,
  };
}

type Row = Prisma.NotificationGetPayload<object>;
const view = (r: Row): NotificationView => ({
  id: r.id,
  role: r.role,
  type: r.type,
  title: r.title,
  body: r.body,
  link: r.link,
  whatsappText: r.whatsappText,
  createdAt: r.createdAt.toISOString(),
  readAt: r.readAt ? r.readAt.toISOString() : null,
});

export async function listNotifications(
  deps: AppDeps,
  caller: Caller,
  page: { cursor: string | null; limit: number },
): Promise<{ items: NotificationView[]; nextCursor: string | null }> {
  // Like the activity log, a cursor that is not ours gives an empty page.
  if (page.cursor !== null && !UUID.test(page.cursor)) return { items: [], nextCursor: null };
  const rows = await deps.prisma.notification.findMany({
    where: scopeOf(caller),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  const p = toPage(rows, page.limit, (r) => r.id);
  return { items: p.items.map(view), nextCursor: p.nextCursor };
}

export async function markNotificationRead(
  deps: AppDeps,
  caller: Caller,
  id: string,
): Promise<void> {
  if (!UUID.test(id)) throw notFound('Notification');
  const where: Prisma.NotificationWhereInput = { ...scopeOf(caller), id };
  const found = await deps.prisma.notification.findFirst({ where });
  if (!found) throw notFound('Notification');
  if (found.readAt) return;
  const now = (await resolveClock(deps)).now();
  await deps.prisma.notification.updateMany({
    where: { ...where, readAt: null },
    data: { readAt: now },
  });
}

/** How many of the caller's notifications (for the active membership) are unread: the bell count. */
export async function countUnreadNotifications(deps: AppDeps, caller: Caller): Promise<number> {
  return deps.prisma.notification.count({ where: { ...scopeOf(caller), readAt: null } });
}
