import type { Prisma, Role } from '@/generated/prisma/client';
import type { TxContext } from '@/server/platform/tx';
import type { NotificationMessage } from './templates';

export { TEMPLATES } from './templates';
export { whatsappShareUrl } from '@/lib/whatsapp';

export type NotifyInput = {
  type: string;
  audience: {
    shopId?: string;
    supplierId?: string;
    operator?: boolean;
    userIds?: string[];
    roles: Role[];
  };
  link: string;
  message: (role: Role) => NotificationMessage;
  dedupeKey?: string;
};

const WHATSAPP_MAX = 300;
const AMOUNT = /RM\s?\d/;

function validate(role: Role, m: NotificationMessage): void {
  if (m.whatsappText.length > WHATSAPP_MAX) {
    throw new Error(`WhatsApp text is over ${WHATSAPP_MAX} characters for role ${role}.`);
  }
  if (role === 'staff' && [m.title, m.body, m.whatsappText].some((t) => AMOUNT.test(t))) {
    throw new Error('Staff notifications must not contain an amount.');
  }
}

export async function notify(ctx: TxContext, input: NotifyInput): Promise<number> {
  const { audience } = input;
  const roles = [...new Set(audience.roles)];

  // Check every message before anything is written.
  const messages = new Map<Role, NotificationMessage>();
  for (const role of roles) {
    const m = input.message(role);
    validate(role, m);
    messages.set(role, m);
  }

  const orgs: Prisma.MembershipWhereInput[] = [];
  if (audience.shopId) orgs.push({ shopId: audience.shopId });
  if (audience.supplierId) orgs.push({ supplierId: audience.supplierId });
  if (audience.operator) orgs.push({ orgType: 'operator' });
  if (orgs.length === 0 && !audience.userIds) {
    throw new Error('A notification audience needs an organisation or user ids.');
  }

  const memberships = await ctx.tx.membership.findMany({
    where: {
      endedAt: null,
      role: { in: roles },
      ...(orgs.length > 0 ? { OR: orgs } : {}),
      ...(audience.userIds ? { userId: { in: audience.userIds } } : {}),
    },
    orderBy: { id: 'asc' },
  });

  const seen = new Set<string>();
  const data: Prisma.NotificationCreateManyInput[] = [];
  for (const m of memberships) {
    const key = `${m.userId}:${m.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const msg = messages.get(m.role)!;
    data.push({
      userId: m.userId,
      role: m.role,
      shopId: m.shopId,
      supplierId: m.supplierId,
      type: input.type,
      title: msg.title,
      body: msg.body,
      link: input.link,
      whatsappText: msg.whatsappText,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${m.userId}` : null,
      createdAt: ctx.now,
    });
  }
  if (data.length === 0) return 0;
  const res = await ctx.tx.notification.createMany({ data, skipDuplicates: true });
  return res.count;
}
