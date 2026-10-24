import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { SupplierProductView } from '@/lib/views/supplier';
import { isoWeekOf } from '@/lib/time';
import { validateTiers } from '@/server/engine/tiers';
import { appendLog } from '@/server/modules/activity/log';
import {
  MAX_PHOTO_BYTES,
  photoExtension,
  UPLOAD_LINK_SECONDS,
} from '@/server/modules/checks/photos';
import { openNextRound } from '@/server/modules/rounds/open';
import { productImageUrl } from '@/server/modules/rounds/read';
import { OPEN_ROUND_CUTOFF, toSupplierProductView } from '@/server/modules/supplier-orders/portal';
import type { SignedUpload } from '@/server/adapters/storage/types';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { notFound, unprocessable } from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { requireRole, requireSupplierAccess } from '@/server/platform/permissions';
import { withTransaction, type TxContext } from '@/server/platform/tx';

const tierInput = z.strictObject({
  minQuantity: z.number().int(),
  unitPriceSen: z.number().int(),
});

/** What a supplier may set on a product. Strict: unknown fields are refused. */
export const productInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  shortName: z.string().trim().min(1).max(100),
  category: z.enum(['dairy', 'oil', 'flour', 'beverages', 'eggs', 'packaging']),
  packDescription: z.string().trim().min(1).max(200),
  unitName: z.enum(['carton', 'tin', 'tray', 'sack', 'pack']),
  unitWeightGrams: z.number().int().positive(),
  buyAlonePriceSen: z.number().int().positive(),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20),
  packConversions: z.record(z.string(), z.number().int().positive()).optional(),
  cadence: z.enum(['weekly', 'fortnightly', 'monthly']),
  scheduleAnchorWeek: z
    .string()
    .regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/)
    .optional(),
  cutoffWeekday: z.number().int().min(1).max(7),
  cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  tiers: z.array(tierInput).max(20),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const productPatchSchema = productInputSchema.partial().extend({
  active: z.boolean().optional(),
  /** A key from `requestProductImageUpload`, once the file has been uploaded. */
  imageKey: z.string().min(1).max(300).optional(),
});
export type ProductPatch = z.infer<typeof productPatchSchema>;

function assertTiers(tiers: ProductInput['tiers'], buyAlonePriceSen: number): void {
  const result = validateTiers(tiers, { buyAlonePriceSen });
  if (!result.ok) {
    throw unprocessable('INVALID_TIERS', 'The price ladder is not valid.', {
      errors: result.errors,
    });
  }
}

type ProductRow = Prisma.ProductGetPayload<{ include: { tiers: true } }>;

/** The product's editable fields as a log value; with `keys`, only those fields. */
function snapshot(p: ProductRow, keys?: string[]): Prisma.InputJsonObject {
  const all: Record<string, unknown> = {
    name: p.name,
    shortName: p.shortName,
    category: p.category,
    packDescription: p.packDescription,
    unitName: p.unitName,
    unitWeightGrams: p.unitWeightGrams,
    buyAlonePriceSen: p.buyAlonePriceSen,
    aliases: p.aliases,
    packConversions: p.packConversions,
    cadence: p.cadence,
    scheduleAnchorWeek: p.scheduleAnchorWeek,
    cutoffWeekday: p.cutoffWeekday,
    cutoffTime: p.cutoffTime,
    active: p.active,
    imageKey: p.imageKey,
    tiers: [...p.tiers]
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ minQuantity: t.minQuantity, unitPriceSen: t.unitPriceSen })),
  };
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => !keys || keys.includes(k)),
  ) as Prisma.InputJsonObject;
}

/** Creates a product with its tiers and opens its first round. Runs inside the caller's transaction. */
export async function createProductInTx(
  ctx: TxContext,
  supplierId: string,
  input: ProductInput,
): Promise<SupplierProductView> {
  assertTiers(input.tiers, input.buyAlonePriceSen);
  const { tx, now } = ctx;
  const product = await tx.product.create({
    data: {
      supplierId,
      name: input.name,
      shortName: input.shortName,
      category: input.category,
      packDescription: input.packDescription,
      unitName: input.unitName,
      unitWeightGrams: input.unitWeightGrams,
      buyAlonePriceSen: input.buyAlonePriceSen,
      aliases: input.aliases,
      packConversions: input.packConversions ?? {},
      imageAiGenerated: false,
      cadence: input.cadence,
      scheduleAnchorWeek: input.scheduleAnchorWeek ?? isoWeekOf(now),
      cutoffWeekday: input.cutoffWeekday,
      cutoffTime: input.cutoffTime,
      active: true,
      tiers: {
        create: input.tiers.map((t, i) => ({
          position: i + 1,
          minQuantity: t.minQuantity,
          unitPriceSen: t.unitPriceSen,
        })),
      },
    },
    include: { tiers: true },
  });
  const round = await openNextRound(ctx, product.id, now);
  await appendLog(ctx, {
    action: 'product.created',
    subjectType: 'product',
    subjectId: product.id,
    scope: { supplierId, operator: true },
    after: snapshot(product),
  });
  return toSupplierProductView(
    { ...product, rounds: [{ cutoffAt: round.cutoffAt }] },
    productImageUrl(ctx.deps, product),
    now,
  );
}

/** What storage holds at a patched `imageKey`: null when absent or outside the product's folder. */
type StoredImage = { sizeBytes: number; contentType: string } | null;

/**
 * Looks up a patched photo in storage. A network call in production, so it runs before the
 * transaction opens; `updateProductInTx` then judges the result in its usual order.
 */
async function statPatchedImage(
  deps: AppDeps,
  productId: string,
  imageKey: string,
): Promise<StoredImage> {
  return imageKey.startsWith(`supplier/${productId}/`)
    ? deps.storage.statObject('product-images', imageKey)
    : null;
}

/**
 * Changes a product. Tier edits replace its price tiers; the open round keeps the tiers, unit and
 * pack it was opened with, so a change reaches owners from the next round. Runs inside the
 * caller's transaction. A patch with `imageKey` needs `storedImage`, looked up beforehand with
 * `statPatchedImage`.
 */
export async function updateProductInTx(
  ctx: TxContext,
  supplierId: string,
  productId: string,
  patch: ProductPatch,
  storedImage?: StoredImage,
): Promise<SupplierProductView> {
  if (!UUID.test(productId)) throw notFound('Product');
  const { tx } = ctx;
  const existing = await tx.product.findFirst({
    where: { id: productId, supplierId },
    include: { tiers: { orderBy: { position: 'asc' } } },
  });
  if (!existing) throw notFound('Product');

  if (patch.tiers || patch.buyAlonePriceSen !== undefined) {
    const tiers =
      patch.tiers ??
      existing.tiers.map((t) => ({ minQuantity: t.minQuantity, unitPriceSen: t.unitPriceSen }));
    assertTiers(tiers, patch.buyAlonePriceSen ?? existing.buyAlonePriceSen);
  }

  if (patch.imageKey !== undefined) {
    if (storedImage === undefined) throw new Error('An imageKey patch needs its storage lookup.');
    const stored = storedImage;
    const acceptable =
      !!stored &&
      photoExtension(stored.contentType) !== undefined &&
      stored.sizeBytes <= MAX_PHOTO_BYTES;
    if (!acceptable) {
      throw unprocessable(
        'IMAGE_NOT_UPLOADED',
        'That photo has not been uploaded, or is not a JPEG, PNG or WebP of 5 MB or less.',
      );
    }
  }

  const { tiers: newTiers, ...fields } = patch;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data[key] = value;
  }
  // A supplier's own photo is never labelled as generated.
  if (patch.imageKey !== undefined) data.imageAiGenerated = false;
  if (Object.keys(data).length > 0) {
    await tx.product.update({ where: { id: productId }, data: data as Prisma.ProductUpdateInput });
  }
  if (newTiers) {
    await tx.priceTier.deleteMany({ where: { productId } });
    await tx.priceTier.createMany({
      data: newTiers.map((t, i) => ({
        productId,
        position: i + 1,
        minQuantity: t.minQuantity,
        unitPriceSen: t.unitPriceSen,
      })),
    });
  }

  const updated = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    include: { tiers: { orderBy: { position: 'asc' } }, rounds: OPEN_ROUND_CUTOFF },
  });
  const keys = Object.keys(patch).filter(
    (k) => (patch as Record<string, unknown>)[k] !== undefined,
  );
  await appendLog(ctx, {
    action: 'product.updated',
    subjectType: 'product',
    subjectId: productId,
    scope: { supplierId, operator: true },
    before: snapshot(existing, keys),
    after: snapshot(updated, keys),
  });
  return toSupplierProductView(updated, productImageUrl(ctx.deps, updated), ctx.now);
}

/** Supplier only, and only for its own supplier id (another is 404). */
export function requireOwnSupplier(caller: Caller, supplierId: string): void {
  requireRole(caller, ['supplier']);
  if (!UUID.test(supplierId)) throw notFound('Supplier');
  requireSupplierAccess(caller, supplierId);
}

export async function createSupplierProduct(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
  input: ProductInput,
): Promise<SupplierProductView> {
  requireOwnSupplier(caller, supplierId);
  return withTransaction(deps, caller, (ctx) => createProductInTx(ctx, supplierId, input));
}

export async function updateSupplierProduct(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
  productId: string,
  patch: ProductPatch,
): Promise<SupplierProductView> {
  requireOwnSupplier(caller, supplierId);
  const storedImage =
    patch.imageKey !== undefined && UUID.test(productId)
      ? await statPatchedImage(deps, productId, patch.imageKey)
      : undefined;
  return withTransaction(deps, caller, (ctx) =>
    updateProductInTx(ctx, supplierId, productId, patch, storedImage),
  );
}

/**
 * Asks for a signed link to upload one photo of a product (JPEG, PNG or WebP, up to 5 MB).
 * Nothing is written to the database: the photo is attached by a later PATCH with the returned
 * `imageKey`, once the upload exists in storage.
 */
export async function requestProductImageUpload(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
  productId: string,
  input: { contentType: string; sizeBytes: number },
): Promise<{ imageKey: string; upload: SignedUpload }> {
  requireOwnSupplier(caller, supplierId);
  if (!UUID.test(productId)) throw notFound('Product');
  const product = await deps.prisma.product.findFirst({
    where: { id: productId, supplierId },
    select: { id: true },
  });
  if (!product) throw notFound('Product');
  const ext = photoExtension(input.contentType);
  if (!ext) throw unprocessable('UNSUPPORTED_TYPE', 'Please choose a JPEG, PNG or WebP photo.');
  if (input.sizeBytes > MAX_PHOTO_BYTES) {
    throw unprocessable(
      'TOO_LARGE',
      'That photo is bigger than 5 MB. Please choose a smaller one.',
    );
  }
  const imageKey = `supplier/${productId}/${randomUUID()}.${ext}`;
  const upload = await deps.storage.createSignedUploadUrl('product-images', imageKey, {
    contentType: input.contentType,
    maxBytes: input.sizeBytes,
    expiresInSeconds: UPLOAD_LINK_SECONDS,
  });
  return { imageKey, upload };
}
