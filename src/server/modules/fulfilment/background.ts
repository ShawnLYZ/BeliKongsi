import { actorOf, systemCaller } from '@/server/platform/caller';
import type { TxContext } from '@/server/platform/tx';
import { recordAllReceived } from '@/server/modules/checks/delivery-check';
import { canHandOver, handOverPickup } from './handover';

const REASON = 'background shop simulation';

/**
 * Background (simulated) shops collect on their own (PRD §10, story 133). Of the given pickups,
 * those of a background shop move on: a pickup-point pickup that is `ready` becomes `collected`,
 * a door pickup that is `out_for_delivery` becomes `delivered`, and a `partly_ready` one hands over
 * the part that is there (see `handOverPickup`, which also completes a consignment whose last
 * goods these were). In the same transaction it records "All received" for that collection, so a
 * pickup handed over in full ends `closed`. Real shops are never touched. Runs in the caller's
 * transaction, logged by the system. Returns how many pickups it handed over.
 */
export async function runBackgroundAutomation(
  outer: TxContext,
  pickupIds: string[],
): Promise<number> {
  const caller = systemCaller(REASON);
  const ctx: TxContext = { ...outer, caller, actor: actorOf(caller) };
  const { tx } = ctx;
  let changed = 0;
  for (const id of [...new Set(pickupIds)].sort()) {
    const pickup = await tx.pickup.findUnique({ where: { id } });
    if (!pickup || !canHandOver(pickup)) continue;
    const shop = await tx.shop.findUnique({
      where: { id: pickup.shopId },
      select: { isBackground: true },
    });
    if (!shop?.isBackground) continue;
    // The caller's reason is not copied to the log row, so it is passed explicitly.
    const collectionId = await handOverPickup(ctx, pickup, { reason: REASON, method: 'system' });
    if (collectionId) {
      changed += 1;
      // Nobody checks a simulated shop's goods: the system records "All received" at once.
      const handed = await tx.pickup.findUniqueOrThrow({ where: { id } });
      await recordAllReceived(ctx, handed, collectionId, undefined, { reason: REASON });
    }
  }
  return changed;
}
