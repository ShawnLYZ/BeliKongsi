import type { TxContext } from '@/server/platform/tx';
import { PRODUCTS } from './catalogue';
import { atTimesFrom, openJoinAndPay } from './week';

const ALL_PRODUCTS = new Set(PRODUCTS.map((p) => p.key));

/**
 * Builds the demo week (index §5.1, §5.7) through the real services, inside the seed's
 * transaction: products without an open round get one Thursday 8 pm (after the history week there
 * are none: its cut-off opened the weekly rounds and the fortnightly ones are still open),
 * background shops join every round Friday to Sunday, and Gerai's and Kafe's baskets are drafted
 * Monday 06:00 and paid at 06:01 and 06:03. The transaction's own time (the anchor in tests) is
 * restored at the end.
 */
export async function seedCurrentWeek(ctx: TxContext, anchorMonday: Date): Promise<void> {
  await atTimesFrom(ctx, anchorMonday, (at) => openJoinAndPay(ctx, anchorMonday, at, ALL_PRODUCTS));
}
