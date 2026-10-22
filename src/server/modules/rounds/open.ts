import type { Prisma, Round } from '@/generated/prisma/client';
import { resolveClock } from '@/server/adapters/clock';
import { appendLog } from '@/server/modules/activity/log';
import { emitEvent } from '@/server/modules/integration/events';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { isoWeekOf } from '@/lib/time';
import { expectedReadyAt, nextCutoffAfter } from './schedule';

const FEE_BPS = 200;

/** Opens the product's next round with its tiers frozen as they are now. */
export async function openNextRound(
  ctx: TxContext,
  productId: string,
  opensAt: Date,
): Promise<Round> {
  const { tx } = ctx;
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    include: { supplier: true, tiers: { orderBy: { position: 'asc' } } },
  });
  const cutoffAt = nextCutoffAfter(product, opensAt);
  const tiers = product.tiers.map((t) => ({
    minQuantity: t.minQuantity,
    unitPriceSen: t.unitPriceSen,
  }));

  const round = await tx.round.create({
    data: {
      productId: product.id,
      supplierId: product.supplierId,
      hubId: product.supplier.hubId,
      cycleLabel: isoWeekOf(cutoffAt),
      opensAt,
      cutoffAt,
      expectedReadyAt: expectedReadyAt(cutoffAt),
      tiersSnapshot: tiers,
      feeBps: FEE_BPS,
      buyAlonePriceSen: product.buyAlonePriceSen,
      unitWeightGrams: product.unitWeightGrams,
      status: 'open',
    },
  });

  await appendLog(ctx, {
    action: 'round.opened',
    subjectType: 'round',
    subjectId: round.id,
    scope: { supplierId: round.supplierId, operator: true },
    after: { productId: round.productId, cycleLabel: round.cycleLabel } as Prisma.InputJsonValue,
  });
  await emitEvent(ctx, 'round.opened', {
    roundId: round.id,
    productId: round.productId,
    supplierId: round.supplierId,
    cutoffAt: cutoffAt.toISOString(),
    tiers,
  });
  return round;
}

/** Opens a round at `now` for each active product that has none open. */
export async function openDueRounds(deps: AppDeps): Promise<{ opened: number }> {
  const now = (await resolveClock(deps)).now();
  const products = await deps.prisma.product.findMany({
    where: { active: true, rounds: { none: { status: 'open' } } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let opened = 0;
  for (const { id } of products) {
    // One transaction per round: its insert, log entry and event commit together.
    await withTransaction(deps, systemCaller('open rounds'), async (ctx) => {
      await openNextRound(ctx, id, now);
    });
    opened += 1;
  }
  return { opened };
}
