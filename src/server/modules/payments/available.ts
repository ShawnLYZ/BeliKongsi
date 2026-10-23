import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { balanceOf } from '@/server/modules/ledger/accounts';

export type AvailableBalance = {
  /** The shop balance as the ledger holds it. */
  balanceSen: number;
  /** What is left once pending payments have taken what they plan to use; never below zero. */
  availableSen: number;
};

/**
 * The shop balance and the part of it that is free to use. The balance other pending payments
 * already plan to use is reserved for them. A pending payment past its deadline can no longer
 * succeed (its result is voided), so it reserves nothing.
 */
export async function availableBalance(
  db: Prisma.TransactionClient | PrismaClient,
  shopId: string,
  now: Date,
): Promise<AvailableBalance> {
  const [balanceSen, reserved] = await Promise.all([
    balanceOf(db, { kind: 'shop_balance', shopId }),
    db.payment.aggregate({
      where: { shopId, status: 'pending', deadlineAt: { gt: now } },
      _sum: { balanceAppliedSen: true },
    }),
  ]);
  const availableSen = Math.max(0, balanceSen - (reserved._sum.balanceAppliedSen ?? 0));
  return { balanceSen, availableSen };
}
