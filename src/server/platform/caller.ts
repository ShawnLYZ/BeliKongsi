import type { Role } from '@/generated/prisma/client';
import type { Session } from './session';

export type Actor =
  | { type: 'person'; userId: string; role: Role; shopId?: string; supplierId?: string }
  | { type: 'system'; reason: string }
  | { type: 'ai'; model: string };

export type Caller = { kind: 'person'; session: Session } | { kind: 'system'; reason: string };

export const personCaller = (session: Session): Caller => ({ kind: 'person', session });
export const systemCaller = (reason: string): Caller => ({ kind: 'system', reason });

export function actorOf(caller: Caller): Actor {
  if (caller.kind === 'system') return { type: 'system', reason: caller.reason };
  const { session } = caller;
  const actor: Actor = {
    type: 'person',
    userId: session.userId,
    role: session.membership.role,
  };
  if (session.membership.shopId) actor.shopId = session.membership.shopId;
  if (session.membership.supplierId) actor.supplierId = session.membership.supplierId;
  return actor;
}
