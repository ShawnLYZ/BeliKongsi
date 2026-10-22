import { isoWeekOf } from '@/lib/time';
import { approveBasket } from '@/server/modules/baskets/approve';
import { draftBasketForShop } from '@/server/modules/baskets/draft';
import { joinRound } from '@/server/modules/payments/join';
import { simulatePaymentResult } from '@/server/modules/payments/simulate';
import { openNextRound } from '@/server/modules/rounds/open';
import { personCaller, systemCaller } from '@/server/platform/caller';
import type { Session } from '@/server/platform/session';
import { setTransactionNow, withTransaction, type TxContext } from '@/server/platform/tx';
import { seedId } from './ids';
import { BACKGROUND_QUANTITIES, BACKGROUND_SHOP_COUNT } from './shops';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Times relative to the anchor, Monday 06:05 MYT (index §5.1). */
const ROUNDS_OPEN = -(3 * DAY_MS + 10 * HOUR_MS + 5 * MINUTE_MS); // Thu 20:00
const FIRST_BACKGROUND_JOIN = -(2 * DAY_MS + 21 * HOUR_MS + 5 * MINUTE_MS); // Fri 09:00
const BACKGROUND_JOIN_GAP = 45 * MINUTE_MS; // k = 80 lands on Sun 21:00
const BASKETS_DRAFTED = -5 * MINUTE_MS; // Mon 06:00
const GERAI_PAYS = -4 * MINUTE_MS; // Mon 06:01
const KAFE_PAYS = -2 * MINUTE_MS; // Mon 06:03

const backgroundShopKey = (k: number) =>
  `BG${String((k % BACKGROUND_SHOP_COUNT) + 1).padStart(2, '0')}`;

/** The session of a seeded owner, read through the seed transaction. */
async function ownerSession(ctx: TxContext, userKey: string): Promise<Session> {
  const m = await ctx.tx.membership.findUniqueOrThrow({
    where: { id: seedId('membership', userKey) },
    include: { user: true, shop: true },
  });
  if (!m.shopId || !m.shop) throw new Error(`Seed user ${userKey} has no shop.`);
  return {
    userId: m.userId,
    displayName: m.user.displayName,
    membership: {
      id: m.id,
      role: m.role,
      orgType: m.orgType,
      orgId: m.shopId,
      orgName: m.shop.name,
      shopId: m.shopId,
    },
  };
}

/** The owner approves the shop's basket and the simulated payment succeeds. */
async function ownerPays(
  ctx: TxContext,
  userKey: string,
  shopKey: string,
  week: string,
  method: 'duitnow_qr' | 'fpx',
): Promise<void> {
  const caller = personCaller(await ownerSession(ctx, userKey));
  const basket = await ctx.tx.weeklyBasket.findUniqueOrThrow({
    where: { shopId_basketWeek: { shopId: seedId('shop', shopKey), basketWeek: week } },
    select: { id: true },
  });
  const summary = await approveBasket(ctx.deps, caller, basket.id);
  if (summary.status === 'succeeded') return;
  const view = await simulatePaymentResult(ctx.deps, caller, summary.paymentId, {
    outcome: 'succeeded',
    method,
  });
  if (view.status !== 'succeeded') throw new Error(`Seed payment for ${shopKey} did not succeed.`);
}

/**
 * Builds the demo week (index §5.1, §5.7) through the real services, inside the seed's
 * transaction: rounds open Thursday 8 pm, background shops join Friday to Sunday, Gerai's and Kafe's
 * baskets are drafted Monday 06:00 and paid at 06:01 and 06:03. Each step runs at its own time by
 * moving the transaction's `now`; the original `now` is restored at the end.
 */
export async function seedCurrentWeek(ctx: TxContext, anchorMonday: Date): Promise<void> {
  const { deps } = ctx;
  const original = ctx.now;
  const at = (offsetMs: number) => {
    const t = new Date(anchorMonday.getTime() + offsetMs);
    setTransactionNow(t);
    return t;
  };
  try {
    // 1. Thursday 20:00: one round per active product.
    const opensAt = at(ROUNDS_OPEN);
    const products = await ctx.tx.product.findMany({
      where: { active: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const roundOf = new Map<string, string>();
    await withTransaction(deps, systemCaller('open rounds'), async (c) => {
      for (const { id } of products) roundOf.set(id, (await openNextRound(c, id, opensAt)).id);
    });

    // 2. Background shops join, every 45 minutes from Friday 09:00, in index §5.7 order.
    const seedCaller = systemCaller('seed');
    let k = 0;
    for (const { product, quantities } of BACKGROUND_QUANTITIES) {
      const roundId = roundOf.get(seedId('product', product));
      if (!roundId) throw new Error(`No open round for ${product}.`);
      for (const quantity of quantities) {
        at(FIRST_BACKGROUND_JOIN + k * BACKGROUND_JOIN_GAP);
        await joinRound(
          deps,
          seedCaller,
          roundId,
          { quantity },
          {
            shopId: seedId('shop', backgroundShopKey(k)),
            source: 'background_seed',
            settleImmediatelyWith: 'fpx',
          },
        );
        k += 1;
      }
    }

    // 3. Monday 06:00: the weekly baskets of the shops with usual lists.
    const week = isoWeekOf(anchorMonday);
    at(BASKETS_DRAFTED);
    await withTransaction(deps, systemCaller('draft weekly baskets'), async (c) => {
      for (const shopKey of ['GERAI', 'KAFE']) {
        await draftBasketForShop(c, seedId('shop', shopKey), week);
      }
    });

    // 4–5. Siti pays Gerai's basket at 06:01 and Mei pays Kafe's at 06:03.
    at(GERAI_PAYS);
    await ownerPays(ctx, 'siti', 'GERAI', week, 'duitnow_qr');
    at(KAFE_PAYS);
    await ownerPays(ctx, 'mei', 'KAFE', week, 'fpx');
  } finally {
    // 6. Back to the transaction's own time (the anchor in tests).
    setTransactionNow(original);
  }
}
