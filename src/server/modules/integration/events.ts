import type { Prisma } from '@/generated/prisma/client';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { forbidden } from '@/server/platform/errors';
import type { TxContext } from '@/server/platform/tx';

// PRD section 21.
export const EVENT_TYPES = [
  'round.opened',
  'round.closed',
  'round.cancelled',
  'basket.drafted',
  'basket.approved',
  'basket.skipped',
  'basket.expired',
  'participation.joined',
  'participation.cancelled',
  'participation.dropped',
  'refund.issued',
  'supplier_order.approved',
  'supplier_order.confirmed',
  'supplier_order.rejected',
  'supplier_order.dispatched',
  'hub_check.recorded',
  'supplier_payout.released',
  'consignment.status_changed',
  'pickup.ready',
  'pickup.collected',
  'delivery.checked',
  'claim.submitted',
  'claim.decided',
  'balance.withdrawn',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const FORBIDDEN_KEY = /name|phone|email|address/i;

function assertNoContactKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoContactKeys(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(k)) {
        throw new Error(
          `Event data must not carry names or contact details: key "${k}" at ${path}.`,
        );
      }
      assertNoContactKeys(v, `${path}.${k}`);
    }
  }
}

export async function emitEvent(
  ctx: TxContext,
  type: EventType,
  data: Record<string, unknown>,
): Promise<void> {
  assertNoContactKeys(data, 'data');
  const event = await ctx.tx.integrationEvent.create({
    data: { type, version: 1, occurredAt: ctx.now, data: data as Prisma.InputJsonObject },
  });
  // Queued in the same transaction, so a delivery exists exactly when its event does.
  const subscriptions = await ctx.tx.webhookSubscription.findMany({
    where: { active: true, eventTypes: { has: type } },
    select: { id: true },
  });
  if (subscriptions.length === 0) return;
  await ctx.tx.webhookDelivery.createMany({
    data: subscriptions.map((s) => ({
      subscriptionId: s.id,
      eventId: event.id,
      attempt: 0,
      status: 'pending' as const,
      nextAttemptAt: ctx.now,
    })),
  });
}

export type EventView = {
  id: string;
  seq: string;
  type: string;
  version: number;
  occurredAt: string;
  data: Prisma.JsonValue;
};

export async function listEvents(deps: AppDeps, caller: Caller): Promise<EventView[]> {
  if (caller.kind !== 'person' || caller.session.membership.role !== 'ops') throw forbidden();
  const rows = await deps.prisma.integrationEvent.findMany({ orderBy: { seq: 'desc' }, take: 100 });
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq.toString(),
    type: r.type,
    version: r.version,
    occurredAt: r.occurredAt.toISOString(),
    data: r.data,
  }));
}
