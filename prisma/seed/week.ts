import { isoWeekOf } from '@/lib/time';
import { approveBasket } from '@/server/modules/baskets/approve';
import { draftBasketForShop } from '@/server/modules/baskets/draft';
import { joinRound } from '@/server/modules/payments/join';
import { simulatePaymentResult } from '@/server/modules/payments/simulate';
import { openDueRounds } from '@/server/modules/rounds/open';
import { personCaller, systemCaller, type Caller } from '@/server/platform/caller';
import { sessionForMembership } from '@/server/platform/session';
import { setTransactionNow, withTransaction, type TxContext } from '@/server/platform/tx';
import type { ProductKey } from './catalogue';
import { seedId, type SeedUserKey } from './ids';
import { BACKGROUND_QUANTITIES, BACKGROUND_SHOP_COUNT } from './shops';

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Times relative to a week's Monday 06:05 MYT (index §5.1). */
const ROUNDS_OPEN = -(3 * DAY_MS + 10 * HOUR_MS + 5 * MINUTE_MS); // Thu 20:00
const FIRST_BACKGROUND_JOIN = -(2 * DAY_MS + 21 * HOUR_MS + 5 * MINUTE_MS); // Fri 09:00
const BACKGROUND_JOIN_GAP = 45 * MINUTE_MS; // k = 80 lands on Sun 21:00
const BASKETS_DRAFTED = -5 * MINUTE_MS; // Mon 06:00
const GERAI_PAYS = -4 * MINUTE_MS; // Mon 06:01
const KAFE_PAYS = -2 * MINUTE_MS; // Mon 06:03

/** Moves the seed transaction's `now` to `monday + offsetMs`. */
export type SeedClock = (offsetMs: number) => void;

/**
 * Runs `fn` with a clock relative to `monday` (a Monday 06:05 MYT): each step runs at its own time
 * by moving the transaction's `now`, and the original `now` is restored at the end.
 */
export async function atTimesFrom(
  ctx: TxContext,
  monday: Date,
  fn: (at: SeedClock) => Promise<void>,
): Promise<void> {
  const original = ctx.now;
  try {
    await fn((offsetMs) => setTransactionNow(new Date(monday.getTime() + offsetMs)));
  } finally {
    setTransactionNow(original);
  }
}

/** A seeded person acting through their one membership, read through the seed transaction. */
export async function seededPerson(ctx: TxContext, userKey: SeedUserKey): Promise<Caller> {
  const session = await sessionForMembership(ctx.tx, seedId('membership', userKey));
  if (!session) throw new Error(`Seed user ${userKey} has no membership.`);
  return personCaller(session);
}

const backgroundShopKey = (k: number) =>
  `BG${String((k % BACKGROUND_SHOP_COUNT) + 1).padStart(2, '0')}`;

/** The owner approves the shop's basket and the simulated payment succeeds. */
async function ownerPays(
  ctx: TxContext,
  userKey: SeedUserKey,
  shopKey: string,
  week: string,
  method: 'duitnow_qr' | 'fpx',
): Promise<void> {
  const caller = await seededPerson(ctx, userKey);
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
 * A week up to its paid baskets (index §5.1, §5.7), through the real services: the due rounds
 * open Thursday 8 pm, background shops join the rounds of `products` every 45 minutes from Friday
 * 09:00 (the k-th quantity overall going to `BG` number `(k mod 40) + 1`), and Gerai's and Kafe's
 * baskets are drafted Monday 06:00 and paid at 06:01 and 06:03.
 */
export async function openJoinAndPay(
  ctx: TxContext,
  monday: Date,
  at: SeedClock,
  products: ReadonlySet<ProductKey>,
): Promise<void> {
  const { deps, tx } = ctx;
  // 1. Thursday 20:00: a round for each product without an open one.
  at(ROUNDS_OPEN);
  await openDueRounds(deps);
  const open = await tx.round.findMany({
    where: { status: 'open' },
    select: { id: true, productId: true },
  });
  const roundOf = new Map(open.map((r) => [r.productId, r.id]));

  // 2. Background shops join, every 45 minutes from Friday 09:00, in index §5.7 order.
  const seedCaller = systemCaller('seed');
  let k = 0;
  for (const { product, quantities } of BACKGROUND_QUANTITIES) {
    if (!products.has(product)) continue;
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
  const week = isoWeekOf(monday);
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
}
