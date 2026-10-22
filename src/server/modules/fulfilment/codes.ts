import { randomInt } from 'node:crypto';
import type { TxContext } from '@/server/platform/tx';

/** The random source for pickup codes. A test replaces `randomInt` to force a collision. */
export const codeRandom = { randomInt: (min: number, max: number): number => randomInt(min, max) };

/**
 * A random 6-digit pickup code not used by any open (not `closed`) pickup at the destination
 * (PRD §10). The open codes are read first and a taken code is drawn again: catching the unique
 * violation of `pickups_open_code_per_destination` would abort the whole transaction. The caller
 * holds the destination lock (see `plan.ts`), so no other transaction adds a code meanwhile.
 */
export async function newPickupCode(ctx: TxContext, destinationKey: string): Promise<string> {
  const open = await ctx.tx.pickup.findMany({
    where: { destinationKey, status: { not: 'closed' } },
    select: { code: true },
  });
  const taken = new Set(open.map((p) => p.code));
  for (;;) {
    const code = String(codeRandom.randomInt(0, 1_000_000)).padStart(6, '0');
    if (!taken.has(code)) return code;
  }
}
