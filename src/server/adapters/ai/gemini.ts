import { GoogleGenAI } from '@google/genai';
import { buildPrompt } from './prompt';
import { READ_RESULT_JSON_SCHEMA } from './schema';
import { AiUnavailableError, type OrderReader, type ReadLine, type ReadResult } from './types';

export { AiUnavailableError };

const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_BACKOFF_MS = 2_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Parses the model's JSON. Shape problems that the validator can handle (odd quantities, a
 * confidence outside 0..1) pass through; output that is not the expected object is "unavailable".
 */
export function toReadResult(raw: string): ReadResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AiUnavailableError('The assistant gave an answer that could not be read.');
  }
  if (!isRecord(data) || !Array.isArray(data.lines)) {
    throw new AiUnavailableError('The assistant gave an answer that could not be read.');
  }
  const lines: ReadLine[] = data.lines.filter(isRecord).map((l) => {
    const confidence =
      typeof l.confidence === 'number' && !Number.isNaN(l.confidence) ? l.confidence : 0;
    return {
      sourceText: text(l.sourceText) ?? '',
      productId: text(l.productId),
      quantity: typeof l.quantity === 'number' ? l.quantity : null,
      unitAsWritten: text(l.unitAsWritten),
      confidence: Math.min(1, Math.max(0, confidence)),
      alternatives: Array.isArray(l.alternatives)
        ? l.alternatives.filter((a): a is string => typeof a === 'string')
        : [],
      note: text(l.note),
    };
  });
  const ignoredText = Array.isArray(data.ignoredText)
    ? data.ignoredText.filter((t): t is string => typeof t === 'string')
    : [];
  return { lines, ignoredText };
}

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

export function createGeminiOrderReader(opts: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  generate?: (req: { model: string; prompt: string; text: string }) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}): OrderReader {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ai = opts.generate ? null : new GoogleGenAI({ apiKey: opts.apiKey });
  const generate =
    opts.generate ??
    (async (req: { model: string; prompt: string; text: string }) => {
      const r = await ai!.models.generateContent({
        model: req.model,
        contents: req.text,
        config: {
          systemInstruction: req.prompt,
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseJsonSchema: READ_RESULT_JSON_SCHEMA,
          // The single timeout: client-side, so the request is still billed by Google.
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      });
      return r.text ?? '';
    });

  return {
    model: opts.model,
    async readOrderText({ text: pasted, catalogue }) {
      const req = { model: opts.model, prompt: buildPrompt(catalogue), text: pasted };
      for (let attempt = 0; ; attempt++) {
        try {
          return toReadResult(await generate(req));
        } catch (error) {
          if (error instanceof AiUnavailableError) throw error;
          const status = statusOf(error);
          // Only rate limits and server errors are worth one more try; a timeout has used its budget.
          const retryable = status !== null && (status === 429 || status >= 500);
          if (!retryable || attempt >= 1) {
            throw new AiUnavailableError(
              isTimeout(error) ? 'The assistant took too long to answer.' : undefined,
            );
          }
          await sleep(RETRY_BACKOFF_MS);
        }
      }
    },
  };
}
