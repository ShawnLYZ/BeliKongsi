import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { AppError, conflict, notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';

const SHOP_ROLES = ['owner', 'staff'] as const;

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const UPLOAD_LINK_SECONDS = 10 * 60;
export const VIEW_LINK_SECONDS = 600;
const KEEP_DAYS = 90;

export const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** The file extension for an allowed photo type (own entries only), or undefined. */
export function photoExtension(contentType: string): string | undefined {
  return Object.hasOwn(EXTENSIONS, contentType) ? EXTENSIONS[contentType] : undefined;
}

/**
 * Shop staff or the owner ask to upload one delivery photo (PRD §11, story 79) once the goods
 * are handed over and before the check is sent. Only JPEG, PNG and WebP up to 5 MB are accepted
 * (422 before anything is stored). Returns a signed upload link that expires after 10 minutes;
 * the photo row is kept for 90 days. Another shop's pickup is 404.
 */
export async function requestPhotoUpload(
  deps: AppDeps,
  caller: Caller,
  pickupId: string,
  input: { contentType: string; sizeBytes: number },
): Promise<{
  photoId: string;
  upload: { url: string; method: 'PUT'; headers: Record<string, string> };
}> {
  if (!UUID.test(pickupId)) throw notFound('Pickup');
  const pickup = await deps.prisma.pickup.findUnique({
    where: { id: pickupId },
    select: { shopId: true, status: true },
  });
  if (!pickup) throw notFound('Pickup');
  try {
    requireShopAccess(caller, pickup.shopId, SHOP_ROLES);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) throw notFound('Pickup');
    throw error;
  }
  if (pickup.status !== 'collected' && pickup.status !== 'delivered') {
    throw conflict('NOT_COLLECTED', 'Photos can be added once the goods have been handed over.');
  }
  const ext = photoExtension(input.contentType);
  if (!ext) {
    throw unprocessable('UNSUPPORTED_TYPE', 'Please choose a JPEG, PNG or WebP photo.');
  }
  if (input.sizeBytes > MAX_PHOTO_BYTES) {
    throw unprocessable(
      'TOO_LARGE',
      'That photo is bigger than 5 MB. Please choose a smaller one.',
    );
  }

  const photoId = randomUUID();
  const storageKey = `pickups/${pickupId}/${photoId}.${ext}`;
  const upload = await deps.storage.createSignedUploadUrl('delivery-photos', storageKey, {
    contentType: input.contentType,
    maxBytes: input.sizeBytes,
    expiresInSeconds: UPLOAD_LINK_SECONDS,
  });
  await withTransaction(deps, caller, async ({ tx, now, actor }) => {
    if (actor.type !== 'person') throw new Error('Photos are uploaded by people.');
    await tx.photo.create({
      data: {
        id: photoId,
        pickupId,
        storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedByUserId: actor.userId,
        uploadedAt: now,
        deleteAfter: new Date(now.getTime() + KEEP_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  });
  return { photoId, upload };
}

/** A 10-minute signed link to view one photo: the shop's members and Ops only (story 147). */
export async function photoViewUrl(
  deps: AppDeps,
  caller: Caller,
  photoId: string,
): Promise<string> {
  if (!UUID.test(photoId)) throw notFound('Photo');
  const photo = await deps.prisma.photo.findUnique({
    where: { id: photoId },
    include: { pickup: { select: { shopId: true } } },
  });
  if (!photo || photo.deletedAt) throw notFound('Photo');
  try {
    requireShopAccess(caller, photo.pickup.shopId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) throw notFound('Photo');
    throw error;
  }
  return deps.storage.createSignedReadUrl('delivery-photos', photo.storageKey, VIEW_LINK_SECONDS);
}
