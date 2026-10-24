import { systemCaller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { withTransaction } from '@/server/platform/tx';
import { resolveClock } from '@/server/adapters/clock';
import { appendLog } from '../activity/log';

const BATCH = 100;
const NOT_FOUND = /not.?found|no such|does not exist|404/i;

/**
 * Deletes delivery photos 90 days after upload (P1-19): marks each one deleted and logs it, then
 * removes the stored file. Oldest first, one batch per run. A file that is already gone counts as
 * removed; any other storage failure leaves `storagePurgedAt` empty for `sweepDeletedPhotos`.
 */
export async function deletePhotosPastRetention(deps: AppDeps): Promise<{ deleted: number }> {
  const now = (await resolveClock(deps)).now();
  const due = await deps.prisma.photo.findMany({
    where: { deleteAfter: { lte: now }, deletedAt: null },
    orderBy: [{ deleteAfter: 'asc' }, { id: 'asc' }],
    select: { id: true, storageKey: true, pickupId: true, pickup: { select: { shopId: true } } },
    take: BATCH,
  });
  let deleted = 0;
  for (const photo of due) {
    const marked = await withTransaction(deps, systemCaller('delete photos'), async (ctx) => {
      const { count } = await ctx.tx.photo.updateMany({
        where: { id: photo.id, deletedAt: null },
        data: { deletedAt: ctx.now },
      });
      if (count === 0) return false;
      await appendLog(ctx, {
        action: 'photo.deleted',
        subjectType: 'photo',
        subjectId: photo.id,
        scope: { shopId: photo.pickup.shopId },
        after: { pickupId: photo.pickupId },
      });
      return true;
    });
    if (!marked) continue;
    deleted++;
    try {
      try {
        await deps.storage.deleteObject('delivery-photos', photo.storageKey);
      } catch (error) {
        if (!(error instanceof Error && NOT_FOUND.test(error.message))) throw error;
      }
      await deps.prisma.photo.update({
        where: { id: photo.id },
        data: { storagePurgedAt: (await resolveClock(deps)).now() },
      });
    } catch (error) {
      console.error(
        'Could not delete a stored photo:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  return { deleted };
}
