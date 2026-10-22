import { resolveClock } from '@/server/adapters/clock';
import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction } from '@/server/platform/tx';
import { voidPayment } from './complete';

/**
 * Voids every pending payment past its deadline (PRD 5: "voided, the deadline passed before a
 * result arrived"), so an abandoned checkout stops reserving the shop balance and holding a
 * delivery fee. Goes through `voidPayment`, so each void is logged and its fees reconciled; nothing
 * is charged. Each payment has its own transaction; one that fails is logged and counted in
 * `failed`, and the rest are still voided.
 */
export async function voidOverduePayments(
  deps: AppDeps,
): Promise<{ voided: number; failed: number }> {
  const now = (await resolveClock(deps)).now();
  const due = await deps.prisma.payment.findMany({
    where: { status: 'pending', deadlineAt: { lte: now } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let voided = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const done = await withTransaction(
        deps,
        systemCaller('void overdue payments'),
        async (ctx) => {
          // voidPayment takes the locks (basket, shop, payment) and re-reads the payment under them.
          const p = await ctx.tx.payment.findUniqueOrThrow({ where: { id } });
          if (p.status !== 'pending' || p.deadlineAt.getTime() > ctx.now.getTime()) return false;
          await voidPayment(ctx, id, 'No payment result arrived before the deadline.');
          const after = await ctx.tx.payment.findUniqueOrThrow({ where: { id } });
          return after.status === 'voided';
        },
      );
      if (done) voided += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `Voiding overdue payment ${id} failed:`,
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { voided, failed };
}
