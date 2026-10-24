import { SAMPLE_ORDER_TEXT, SAMPLE_USUAL_PRICES_SEN } from '../../../../prisma/seed/sample-order';
import { seedId } from '../../../../prisma/seed/ids';
import { Prisma } from '@/generated/prisma/client';
import type { ParsedLineView, ParseView } from '@/lib/views/usual-list';
import { redactPersonalData } from '@/server/adapters/ai/redact';
import { SAVED_EXAMPLE } from '@/server/adapters/ai/saved-example';
import {
  AiUnavailableError,
  type CatalogueEntry,
  type ReadResult,
} from '@/server/adapters/ai/types';
import { appendLog } from '@/server/modules/activity/log';
import { catalogueEntriesForAi } from '@/server/modules/catalogue/catalogue';
import { decodeImage } from '@/server/modules/checks/photos';
import { productImageUrl } from '@/server/modules/rounds/read';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { AppError, aiUnavailable, forbidden } from '@/server/platform/errors';
import { requireShopAccess } from '@/server/platform/permissions';
import { enforceRateLimit } from '@/server/platform/rate-limit';
import { withTransaction } from '@/server/platform/tx';

export const MAX_PARSE_CHARS = 2000;
export const MAX_PARSE_LINES = 40;
const MAX_QUANTITY = 999; // the save limit in Task 6
const MAX_ALTERNATIVES = 3;
const CHECK_BELOW_CONFIDENCE = 0.8;

const SAMPLE_PRICE_BY_PRODUCT = new Map(
  Object.entries(SAMPLE_USUAL_PRICES_SEN).map(([key, sen]) => [seedId('product', key), sen]),
);

function validateLines(
  deps: AppDeps,
  result: ReadResult,
  catalogue: CatalogueEntry[],
  imageKeys: Map<string, string | null>,
  withSamplePrices: boolean,
): ParsedLineView[] {
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  return result.lines.map((l) => {
    const product = l.productId ? (byId.get(l.productId) ?? null) : null;
    const alternatives = [...new Set(l.alternatives)]
      .filter((id) => byId.has(id) && id !== product?.id)
      .slice(0, MAX_ALTERNATIVES)
      .map((id) => {
        const c = byId.get(id)!;
        return { id: c.id, name: c.name, packDescription: c.packDescription };
      });
    const quantityOk =
      typeof l.quantity === 'number' &&
      Number.isInteger(l.quantity) &&
      l.quantity > 0 &&
      l.quantity <= MAX_QUANTITY;
    const quantity = quantityOk ? l.quantity : null;
    const status: ParsedLineView['status'] = !product
      ? 'not_found'
      : quantity === null || l.confidence < CHECK_BELOW_CONFIDENCE || alternatives.length > 0
        ? 'check'
        : 'ok';
    const view: ParsedLineView = {
      sourceText: l.sourceText,
      product: product && {
        id: product.id,
        name: product.name,
        packDescription: product.packDescription,
        unitName: product.unitName,
        imageUrl: productImageUrl(deps, { imageKey: imageKeys.get(product.id) ?? null }),
      },
      quantity,
      unitAsWritten: l.unitAsWritten,
      confidence: l.confidence,
      alternatives,
      note: l.note,
      status,
    };
    const price = product && withSamplePrices ? SAMPLE_PRICE_BY_PRODUCT.get(product.id) : undefined;
    if (price !== undefined) view.samplePriceSen = price;
    return view;
  });
}

export async function parseUsualListText(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  input: { text: string; useSavedExample?: boolean },
): Promise<ParseView> {
  requireShopAccess(caller, shopId, ['owner']);
  const useSavedExample = input.useSavedExample === true;
  if (useSavedExample && !deps.env.DEMO_MODE) {
    throw forbidden('The saved example is only available in demo mode.');
  }
  if (
    input.text.length > MAX_PARSE_CHARS ||
    input.text.split(/\r\n|\r|\n/).length > MAX_PARSE_LINES
  ) {
    throw new AppError(
      'INPUT_TOO_LONG',
      400,
      `Please paste at most ${MAX_PARSE_CHARS.toLocaleString('en')} characters and ${MAX_PARSE_LINES} lines.`,
    );
  }

  await enforceRateLimit(deps, `ai-parse:${shopId}`, 10, 3_600_000);

  const { text: redacted } = redactPersonalData(input.text);
  const catalogue = await catalogueEntriesForAi(deps.prisma);
  const started = deps.clock.now().getTime();

  let result: ReadResult;
  let model = deps.ai.model;
  if (useSavedExample) {
    result = SAVED_EXAMPLE;
    model = 'saved-example';
  } else {
    try {
      result = await deps.ai.readOrderText({ text: redacted, catalogue });
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
      await recordFailedRun(deps, {
        shopId,
        kind: 'usual_list_text',
        model,
        redactedInput: redacted,
        message: error.message,
        started,
      });
      throw aiUnavailable({ canUseSavedExample: deps.env.DEMO_MODE });
    }
  }

  const lines = await validateAgainstCatalogue(
    deps,
    result,
    catalogue,
    input.text.trim() === SAMPLE_ORDER_TEXT,
  );
  return saveRun(deps, caller, {
    shopId,
    kind: 'usual_list_text',
    status: useSavedExample ? 'saved_example' : 'succeeded',
    model,
    redactedInput: redacted,
    lines,
    ignoredText: result.ignoredText,
    started,
    log: !useSavedExample,
  });
}

const PHOTO_NOT_STORED = '[photo, not stored]';

/**
 * Builds the usual list from a photo of an old invoice (story 26). Same review as pasted text.
 * The photo is held in memory for the one call and never stored or logged.
 */
export async function parseUsualListPhoto(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  input: { imageBase64: string; mimeType: string },
): Promise<ParseView> {
  requireShopAccess(caller, shopId, ['owner']);
  const image = decodeImage(input.imageBase64, input.mimeType);
  await enforceRateLimit(deps, `ai-parse:${shopId}`, 10, 3_600_000);

  const catalogue = await catalogueEntriesForAi(deps.prisma);
  const started = deps.clock.now().getTime();
  const model = deps.ai.model;

  let result: ReadResult;
  try {
    result = await deps.ai.readOrderImage({ image, catalogue });
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    await recordFailedRun(deps, {
      shopId,
      kind: 'usual_list_photo',
      model,
      redactedInput: PHOTO_NOT_STORED,
      message: error.message,
      started,
    });
    throw aiUnavailable({ canUseSavedExample: false });
  }

  // The photo could not be cleaned before the model saw it, so clean what it read back out of it
  // before anything is stored or shown (the text path's output is already clean).
  const clean = (t: string) => redactPersonalData(t).text;
  result = {
    lines: result.lines.map((l) => ({
      ...l,
      sourceText: clean(l.sourceText),
      note: l.note === null ? null : clean(l.note),
    })),
    ignoredText: result.ignoredText.map(clean),
  };
  const lines = await validateAgainstCatalogue(deps, result, catalogue, false);
  return saveRun(deps, caller, {
    shopId,
    kind: 'usual_list_photo',
    status: 'succeeded',
    model,
    redactedInput: PHOTO_NOT_STORED,
    lines,
    ignoredText: result.ignoredText,
    started,
    log: true,
  });
}

async function validateAgainstCatalogue(
  deps: AppDeps,
  result: ReadResult,
  catalogue: CatalogueEntry[],
  withSamplePrices: boolean,
): Promise<ParsedLineView[]> {
  const imageKeys = new Map(
    (
      await deps.prisma.product.findMany({
        where: { id: { in: catalogue.map((c) => c.id) } },
        select: { id: true, imageKey: true },
      })
    ).map((p) => [p.id, p.imageKey]),
  );
  return validateLines(deps, result, catalogue, imageKeys, withSamplePrices);
}

type RunKind = 'usual_list_text' | 'usual_list_photo';

async function recordFailedRun(
  deps: AppDeps,
  r: {
    shopId: string;
    kind: RunKind;
    model: string;
    redactedInput: string;
    message: string;
    started: number;
  },
) {
  await deps.prisma.aiSuggestionRun.create({
    data: {
      shopId: r.shopId,
      kind: r.kind,
      status: 'failed',
      model: r.model,
      redactedInput: r.redactedInput,
      suggestions: { error: r.message },
      latencyMs: deps.clock.now().getTime() - r.started,
    },
  });
}

/** Stores the run (and its log entry, unless it is the saved example) and builds the review. */
async function saveRun(
  deps: AppDeps,
  caller: Caller,
  r: {
    shopId: string;
    kind: RunKind;
    status: 'succeeded' | 'saved_example';
    model: string;
    redactedInput: string;
    lines: ParsedLineView[];
    ignoredText: string[];
    started: number;
    log: boolean;
  },
): Promise<ParseView> {
  const { shopId, model, lines, ignoredText } = r;
  const latencyMs = deps.clock.now().getTime() - r.started;
  return withTransaction(deps, caller, async (ctx) => {
    const run = await ctx.tx.aiSuggestionRun.create({
      data: {
        shopId,
        kind: r.kind,
        status: r.status,
        model,
        redactedInput: r.redactedInput,
        suggestions: { lines, ignoredText } as unknown as Prisma.InputJsonValue,
        latencyMs,
      },
    });
    if (r.log) {
      const averageConfidence = lines.length
        ? lines.reduce((sum, l) => sum + l.confidence, 0) / lines.length
        : 0;
      await appendLog(
        { ...ctx, actor: { type: 'ai', model } },
        {
          action: 'usual_list.ai_suggested',
          subjectType: 'ai_suggestion_run',
          subjectId: run.id,
          scope: { shopId },
          aiMetadata: {
            model,
            lineCount: lines.length,
            averageConfidence: Math.round(averageConfidence * 100) / 100,
            suggestionRunId: run.id,
          },
        },
      );
    }
    return {
      suggestionRunId: run.id,
      lines,
      ignoredText,
      model,
      source: r.status === 'saved_example' ? ('saved_example' as const) : ('ai' as const),
    };
  });
}
