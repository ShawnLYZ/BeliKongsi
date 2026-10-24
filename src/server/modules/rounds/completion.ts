import { appendLog } from '@/server/modules/activity/log';
import type { TxContext } from '@/server/platform/tx';

/**
 * The rounds of every allocation on a pickup, cancelled ones included: a cancelled allocation
 * still belongs to its round, whose completion waits for this pickup to close.
 */
export async function roundsOfPickup(ctx: TxContext, pickupId: string): Promise<string[]> {
  const { tx } = ctx;
  const allocations = await tx.allocation.findMany({
    where: { pickupId },
    select: { participationId: true },
  });
  const parts = await tx.participation.findMany({
    where: { id: { in: allocations.map((a) => a.participationId) } },
    select: { roundId: true },
  });
  return [...new Set(parts.map((p) => p.roundId))];
}

/**
 * A round is `completed` once every pickup carrying its allocations is `closed` (PRD §10): the
 * goods are with the shops and every delivery check, and any claim, is settled. Looks at each
 * dispatched or at-hub round of the list; a round with no allocated goods, or with goods not yet
 * planned into a pickup, is left alone. Runs in the caller's transaction.
 */
export async function refreshRoundCompletion(ctx: TxContext, roundIds: string[]): Promise<void> {
  const { tx } = ctx;
  for (const id of [...new Set(roundIds)].sort()) {
    const round = await tx.round.findUnique({ where: { id }, select: { status: true } });
    if (!round || (round.status !== 'at_hub' && round.status !== 'dispatched')) continue;
    const parts = await tx.participation.findMany({
      where: { roundId: id },
      select: { id: true },
    });
    const allocations = await tx.allocation.findMany({
      where: { participationId: { in: parts.map((p) => p.id) }, allocated: { gt: 0 } },
      select: { pickupId: true },
    });
    if (allocations.length === 0 || allocations.some((a) => a.pickupId === null)) continue;
    const pickupIds = [...new Set(allocations.map((a) => a.pickupId!))];
    const open = await tx.pickup.count({
      where: { id: { in: pickupIds }, status: { not: 'closed' } },
    });
    if (open > 0) continue;
    const moved = await tx.round.updateMany({
      where: { id, status: round.status },
      data: { status: 'completed' },
    });
    if (moved.count === 0) continue;
    await appendLog(ctx, {
      action: 'round.completed',
      subjectType: 'round',
      subjectId: id,
      scope: { operator: true },
      before: { status: round.status },
      after: { status: 'completed' },
    });
  }
}
