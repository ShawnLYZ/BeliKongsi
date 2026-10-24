import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type {
  PriceListLineError,
  PriceListLineView,
  PriceListParseView,
  PriceListTierView,
} from '@/lib/views/supplier';
import { describePriceListInput } from '@/server/adapters/ai/price-list';
import { redactPersonalData } from '@/server/adapters/ai/redact';
import {
  AiUnavailableError,
  type CatalogueEntry,
  type PriceListImage,
  type PriceListLine,
  type PriceListResult,
} from '@/server/adapters/ai/types';
import { validateTiers } from '@/server/engine/tiers';
import { appendLog } from '@/server/modules/activity/log';
import { MAX_PHOTO_BYTES, photoExtension } from '@/server/modules/checks/photos';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import {
  AppError,
  aiUnavailable,
  badRequest,
  conflict,
  notFound,
  unprocessable,
} from '@/server/platform/errors';
import { UUID } from '@/server/platform/ids';
import { enforceRateLimit } from '@/server/platform/rate-limit';
import { withTransaction } from '@/server/platform/tx';
import {
  createProductInTx,
  productInputSchema,
  requireOwnSupplier,
  updateProductInTx,
} from './supplier-edit';

export const MAX_PRICE_LIST_CHARS = 8000;
export const MAX_PRICE_LIST_LINES = 200;
export const MAX_CONFIRM_LINES = 100;
const IMPORTS_PER_HOUR = 10;

export const priceListParseSchema = z.strictObject({
  text: z.string().optional(),
  /** The photo's bytes, base64 encoded (no `data:` prefix). */
  imageBase64: z.string().optional(),
  mimeType: z.string().max(100).optional(),
});
export type PriceListParseInput = z.infer<typeof priceListParseSchema>;

export const priceListConfirmSchema = z.strictObject({
  suggestionRunId: z.string(),
  lines: z
    .array(
      z.union([
        z.strictObject({ productId: z.string(), patch: productInputSchema.partial() }),
        z.strictObject({ create: productInputSchema }),
      ]),
    )
    .min(1)
    .max(MAX_CONFIRM_LINES),
});
export type PriceListConfirmInput = z.infer<typeof priceListConfirmSchema>;

const SUGGESTION_ALREADY_CONFIRMED = () =>
  conflict('SUGGESTION_ALREADY_CONFIRMED', 'That suggestion was already confirmed.');
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** True when the bytes start the way the claimed photo type does. */
function looksLike(mimeType: string, b: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (mimeType === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mimeType === 'image/png') return b[0] === 0x89 && ascii(1, 4) === 'PNG';
  if (mimeType === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  return false;
}

/** Checks a photo before anything else is spent on it: JPEG, PNG or WebP, at most 5 MB. */
function decodeImage(imageBase64: string, mimeType: string | undefined): PriceListImage {
  if (!mimeType) throw badRequest('Please say what kind of photo this is.');
  if (photoExtension(mimeType) === undefined) {
    throw unprocessable('UNSUPPORTED_TYPE', 'Please choose a JPEG, PNG or WebP photo.');
  }
  if (imageBase64.length % 4 !== 0 || !BASE64.test(imageBase64)) {
    throw badRequest('The photo could not be read.');
  }
  const bytes = new Uint8Array(Buffer.from(imageBase64, 'base64'));
  if (bytes.byteLength === 0) throw badRequest('The photo is empty.');
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw unprocessable(
      'TOO_LARGE',
      'That photo is bigger than 5 MB. Please choose a smaller one.',
    );
  }
  if (!looksLike(mimeType, bytes)) {
    throw unprocessable('UNSUPPORTED_TYPE', 'Please choose a JPEG, PNG or WebP photo.');
  }
  return { bytes, mimeType };
}

const supplierProducts = (deps: AppDeps, supplierId: string) =>
  deps.prisma.product.findMany({
    where: { supplierId },
    orderBy: { name: 'asc' },
    include: { tiers: { orderBy: { position: 'asc' } } },
  });
type SupplierProduct = Awaited<ReturnType<typeof supplierProducts>>[number];

function toCatalogueEntry(p: SupplierProduct): CatalogueEntry {
  return {
    id: p.id,
    name: p.name,
    packDescription: p.packDescription,
    unitName: p.unitName,
    aliases: p.aliases,
    packConversions: Object.fromEntries(
      Object.entries((p.packConversions ?? {}) as Record<string, unknown>).filter(
        (e): e is [string, number] => typeof e[1] === 'number',
      ),
    ),
  };
}

const plainTiers = (tiers: { minQuantity: number; unitPriceSen: number }[]): PriceListTierView[] =>
  tiers.map((t) => ({ minQuantity: t.minQuantity, unitPriceSen: t.unitPriceSen }));

/**
 * Checks one drafted line. An id that is not one of this supplier's products becomes a
 * new-product draft; prices must be whole sen; the ladder is checked against the line's buy-alone
 * price, or the matched product's when the line gives none.
 */
function validateLine(l: PriceListLine, byId: Map<string, SupplierProduct>): PriceListLineView {
  const product = l.productId ? (byId.get(l.productId) ?? null) : null;
  const errors: PriceListLineError[] = [];
  const buyAloneOk =
    l.buyAlonePriceSen === null ||
    (Number.isSafeInteger(l.buyAlonePriceSen) && l.buyAlonePriceSen > 0);
  if (!buyAloneOk) {
    errors.push({
      code: 'BUY_ALONE_NOT_WHOLE_SEN',
      position: null,
      message: 'The buy-alone price must be a whole number of sen above zero.',
    });
  }
  const tiers = plainTiers(l.tiers);
  const buyAlonePriceSen = buyAloneOk
    ? (l.buyAlonePriceSen ?? product?.buyAlonePriceSen)
    : undefined;
  const checked = validateTiers(tiers, buyAlonePriceSen === undefined ? {} : { buyAlonePriceSen });
  if (!checked.ok) errors.push(...checked.errors);
  return {
    sourceText: l.sourceText,
    productId: product?.id ?? null,
    proposedName: l.proposedName,
    packDescription: l.packDescription,
    unitName: l.unitName,
    buyAlonePriceSen: l.buyAlonePriceSen,
    tiers,
    confidence: Math.min(1, Math.max(0, l.confidence)),
    note: l.note,
    errors,
    current: product && {
      name: product.name,
      packDescription: product.packDescription,
      unitName: product.unitName,
      buyAlonePriceSen: product.buyAlonePriceSen,
      tiers: plainTiers(product.tiers),
    },
  };
}

/**
 * Supplier only, for its own products. Reads a pasted or photographed price list into drafted
 * tier tables and saves nothing to the catalogue (P1-13, story 114). Text is redacted before it
 * leaves the server; a photo (JPEG, PNG or WebP, at most 5 MB) is checked first and never stored,
 * and the run records only a marker for it. At most 10 imports per supplier per hour. The run is
 * stored and logged as `price_list.ai_suggested` with actor AI.
 */
export async function parsePriceList(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
  input: PriceListParseInput,
): Promise<PriceListParseView> {
  requireOwnSupplier(caller, supplierId);
  const text = input.text?.trim() ? input.text : undefined;
  const image =
    input.imageBase64 !== undefined ? decodeImage(input.imageBase64, input.mimeType) : undefined;
  if (!text && !image) throw badRequest('Please paste a price list or add a photo of one.');
  if (
    text &&
    (text.length > MAX_PRICE_LIST_CHARS || text.split(/\r\n|\r|\n/).length > MAX_PRICE_LIST_LINES)
  ) {
    throw new AppError(
      'INPUT_TOO_LONG',
      400,
      `Please paste at most ${MAX_PRICE_LIST_CHARS.toLocaleString('en')} characters and ${MAX_PRICE_LIST_LINES} lines.`,
    );
  }

  await enforceRateLimit(deps, `price-list:${supplierId}`, IMPORTS_PER_HOUR, 3_600_000);

  const redacted = text === undefined ? undefined : redactPersonalData(text).text;
  const redactedInput = describePriceListInput({ text: redacted, image });
  const products = await supplierProducts(deps, supplierId);
  const model = deps.ai.model;
  const started = deps.clock.now().getTime();

  let result: PriceListResult;
  try {
    result = await deps.ai.readPriceList({
      ...(redacted === undefined ? {} : { text: redacted }),
      ...(image ? { image } : {}),
      products: products.map(toCatalogueEntry),
    });
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    await deps.prisma.aiSuggestionRun.create({
      data: {
        supplierId,
        kind: 'price_list',
        status: 'failed',
        model,
        redactedInput,
        suggestions: { error: error.message },
        latencyMs: deps.clock.now().getTime() - started,
      },
    });
    throw aiUnavailable();
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = result.lines.map((l) => validateLine(l, byId));
  const ignoredText = result.ignoredText;
  const latencyMs = deps.clock.now().getTime() - started;

  return withTransaction(deps, caller, async (ctx) => {
    const run = await ctx.tx.aiSuggestionRun.create({
      data: {
        supplierId,
        kind: 'price_list',
        status: 'succeeded',
        model,
        redactedInput,
        suggestions: { lines, ignoredText } as unknown as Prisma.InputJsonValue,
        latencyMs,
      },
    });
    const averageConfidence = lines.length
      ? lines.reduce((sum, l) => sum + l.confidence, 0) / lines.length
      : 0;
    await appendLog(
      { ...ctx, actor: { type: 'ai', model } },
      {
        action: 'price_list.ai_suggested',
        subjectType: 'ai_suggestion_run',
        subjectId: run.id,
        scope: { supplierId, operator: true },
        aiMetadata: {
          model,
          lineCount: lines.length,
          averageConfidence: Math.round(averageConfidence * 100) / 100,
          suggestionRunId: run.id,
        },
      },
    );
    return { suggestionRunId: run.id, lines, ignoredText, model };
  });
}

type ConfirmLine = PriceListConfirmInput['lines'][number];

const sameTiers = (a: PriceListTierView[], b: PriceListTierView[]) =>
  a.length === b.length &&
  a.every((t, i) => t.minQuantity === b[i]!.minQuantity && t.unitPriceSen === b[i]!.unitPriceSen);

/**
 * Compares the confirmed lines with the drafted ones, product by product: an update whose prices
 * match the draft is accepted unchanged, one that differs is changed, a created product is added,
 * and a drafted product left out is removed. New-product drafts that were not created are not
 * counted.
 */
export function summarisePriceListChanges(
  suggested: Pick<PriceListLineView, 'productId' | 'buyAlonePriceSen' | 'tiers'>[],
  confirmed: ConfirmLine[],
) {
  const drafts = new Map<string, Pick<PriceListLineView, 'buyAlonePriceSen' | 'tiers'>>();
  for (const l of suggested)
    if (l.productId && !drafts.has(l.productId)) drafts.set(l.productId, l);
  let acceptedUnchanged = 0;
  let changed = 0;
  let added = 0;
  const kept = new Set<string>();
  for (const line of confirmed) {
    if ('create' in line) {
      added++;
      continue;
    }
    kept.add(line.productId);
    const draft = drafts.get(line.productId);
    const asDrafted =
      !!draft &&
      (line.patch.tiers === undefined || sameTiers(line.patch.tiers, draft.tiers)) &&
      (line.patch.buyAlonePriceSen === undefined ||
        line.patch.buyAlonePriceSen === draft.buyAlonePriceSen);
    if (asDrafted) acceptedUnchanged++;
    else changed++;
  }
  let removed = 0;
  for (const id of drafts.keys()) if (!kept.has(id)) removed++;
  return { acceptedUnchanged, changed, added, removed };
}

/** The same error, with the 0-based index of the line that caused it in `details.lineIndex`. */
function atLine(error: unknown, lineIndex: number): unknown {
  if (!(error instanceof AppError)) return error;
  const details =
    typeof error.details === 'object' && error.details !== null && !Array.isArray(error.details)
      ? error.details
      : {};
  return new AppError(error.code, error.status, error.message, { ...details, lineIndex });
}

/**
 * Supplier only. Applies the lines the supplier confirmed from one price-list run, all in one
 * transaction: any invalid line (422, with `details.lineIndex`) or a product that is not the
 * supplier's (404) applies nothing. Tier changes reach owners from the next round. Another
 * supplier's run, one that is not a price list, or one that failed is 404; a run already confirmed is 409. Logs
 * `price_list.confirmed` as the person, with a change summary.
 */
export async function confirmPriceList(
  deps: AppDeps,
  caller: Caller,
  supplierId: string,
  input: PriceListConfirmInput,
): Promise<{ updated: number; created: number }> {
  requireOwnSupplier(caller, supplierId);
  if (!UUID.test(input.suggestionRunId)) throw notFound('Suggestion');
  const productIds = input.lines.flatMap((l) => ('productId' in l ? [l.productId] : []));
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('A product can only appear once.');
  }

  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    const run = await tx.aiSuggestionRun.findUnique({ where: { id: input.suggestionRunId } });
    // A failed read has nothing to confirm, so it is treated like a missing run.
    if (
      !run ||
      run.supplierId !== supplierId ||
      run.kind !== 'price_list' ||
      run.status !== 'succeeded'
    ) {
      throw notFound('Suggestion');
    }
    if (run.confirmedAt) throw SUGGESTION_ALREADY_CONFIRMED();

    let updated = 0;
    let created = 0;
    for (const [index, line] of input.lines.entries()) {
      try {
        if ('create' in line) {
          await createProductInTx(ctx, supplierId, line.create);
          created++;
        } else {
          await updateProductInTx(ctx, supplierId, line.productId, line.patch);
          updated++;
        }
      } catch (error) {
        throw atLine(error, index);
      }
    }

    const suggested = (run.suggestions as { lines?: unknown } | null)?.lines;
    const changeSummary = summarisePriceListChanges(
      Array.isArray(suggested) ? (suggested as PriceListLineView[]) : [],
      input.lines,
    );
    const marked = await tx.aiSuggestionRun.updateMany({
      where: { id: run.id, confirmedAt: null },
      data: { confirmedAt: now, changeSummary },
    });
    if (marked.count !== 1) throw SUGGESTION_ALREADY_CONFIRMED();
    await appendLog(ctx, {
      action: 'price_list.confirmed',
      subjectType: 'ai_suggestion_run',
      subjectId: run.id,
      scope: { supplierId, operator: true },
      after: { updated, created, changeSummary, suggestionRunId: run.id },
    });
    return { updated, created };
  });
}
