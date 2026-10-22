import { Prisma } from '@/generated/prisma/client';
import { notFound } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import type { TxContext } from '@/server/platform/tx';

/**
 * Share-locks rounds for the rest of the transaction, in id order, and returns their status and
 * cut-off as they are now. A close in flight (it holds its round for update) finishes first and
 * its result is seen here; a close that starts later waits until this transaction is done.
 *
 * The lock order every money path follows: the rounds involved (shared, here), then the weekly
 * basket, then the shop, then the payment or participation, then ledger accounts (`post`). A close
 * takes its round for update, then its active lines, then every shop it posts to, so no path may
 * hold a shop or a line while it waits for a round. Ids that are not rounds are left out.
 */
export async function lockRounds(
  ctx: TxContext,
  roundIds: string[],
): Promise<{ id: string; status: string; cutoffAt: Date }[]> {
  const ids = [...new Set(roundIds)].filter((id) => UUID.test(id)).sort();
  if (ids.length === 0) return [];
  const rows = await ctx.tx.$queryRaw<{ id: string; status: string; cutoff_at: Date }[]>`
    SELECT id, status::text AS status, cutoff_at FROM rounds
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id FOR SHARE`;
  return rows.map((r) => ({ id: r.id, status: r.status, cutoffAt: r.cutoff_at }));
}

/**
 * Locks the shop row for the rest of the transaction. Creating, settling, failing, voiding and
 * cancelling all take this lock (after their rounds, see `lockRounds`), so they run one after
 * another per shop and always lock ledger accounts in the same order.
 */
export async function lockShop(ctx: TxContext, shopId: string): Promise<void> {
  if (!UUID.test(shopId)) throw notFound('Shop');
  const rows = await ctx.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM shops WHERE id = ${shopId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound('Shop');
}
