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
      await deps.prisma.aiSuggestionRun.create({
        data: {
          shopId,
          kind: 'usual_list_text',
          status: 'failed',
          model,
          redactedInput: redacted,
          suggestions: { error: error.message },
          latencyMs: deps.clock.now().getTime() - started,
        },
      });
      throw aiUnavailable({ canUseSavedExample: deps.env.DEMO_MODE });
    }
  }

  const imageKeys = new Map(
    (
      await deps.prisma.product.findMany({
        where: { id: { in: catalogue.map((c) => c.id) } },
        select: { id: true, imageKey: true },
      })
    ).map((p) => [p.id, p.imageKey]),
  );
  const lines = validateLines(
    deps,
    result,
    catalogue,
    imageKeys,
    input.text.trim() === SAMPLE_ORDER_TEXT,
  );
  const ignoredText = result.ignoredText;
  const latencyMs = deps.clock.now().getTime() - started;

  return withTransaction(deps, caller, async (ctx) => {
    const run = await ctx.tx.aiSuggestionRun.create({
      data: {
        shopId,
        kind: 'usual_list_text',
        status: useSavedExample ? 'saved_example' : 'succeeded',
        model,
        redactedInput: redacted,
        suggestions: { lines, ignoredText } as unknown as Prisma.InputJsonValue,
        latencyMs,
      },
    });
    if (!useSavedExample) {
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
      source: useSavedExample ? ('saved_example' as const) : ('ai' as const),
    };
  });
}
