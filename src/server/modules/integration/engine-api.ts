import { z, type ZodType } from 'zod';
import {
  allocateShortfall,
  closeRound,
  EngineInputError,
  quote,
  type FieldError,
} from '@/server/engine';
import { badRequest, toErrorResponse, unprocessable } from '@/server/platform/errors';
import { json } from '@/server/platform/http';

const MAX_APP_ID_LENGTH = 64;

// Bounds keep every unit product, line amount and sum below Number.MAX_SAFE_INTEGER.
const MAX_MONEY_SEN = 10_000_000;
const MAX_QUANTITY = 100_000;
const MAX_LIST_LENGTH = 5_000;

const int = z.int();
const sen = int.min(-MAX_MONEY_SEN).max(MAX_MONEY_SEN);
const qty = int.max(MAX_QUANTITY);
const MAX_TIERS = 5;
const MAX_STRING_LENGTH = 200;

const text = z.string().max(MAX_STRING_LENGTH);
const joinedAt = z.iso.datetime({ offset: true }).max(MAX_STRING_LENGTH);
const tier = z.strictObject({ minQuantity: qty, unitPriceSen: sen });
const tiers = z.array(tier).max(MAX_TIERS);
const amounts = z.strictObject({ goodsSen: sen, feeSen: sen, shippingSen: sen, allInSen: sen });

const quoteSchema = z.strictObject({
  tiers,
  feeBps: int,
  unitShippingSen: sen,
  quantity: qty,
  currentRoundTotal: qty,
  priceLimitSen: sen.nullish(),
  unitName: text.default('unit'),
});

const closeRoundSchema = z.strictObject({
  tiers,
  feeBps: int,
  unitName: text.optional(),
  participants: z
    .array(
      z.strictObject({
        reference: text,
        quantity: qty,
        joinedAt,
        unitShippingSen: sen,
        priceLimitSen: sen.nullish(),
        paidSen: sen,
      }),
    )
    .max(MAX_LIST_LENGTH),
});

const allocateShortfallSchema = z.strictObject({
  kept: z
    .array(
      z.strictObject({
        reference: text,
        quantity: qty,
        joinedAt,
        final: amounts,
      }),
    )
    .max(MAX_LIST_LENGTH),
  goodUnitsReceived: qty,
  finalGoodsPriceSen: sen,
});

/** Formats a Zod issue path like the engine does: `tiers[1].minQuantity`; the root is ''. */
function formatPath(path: PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out;
}

const ENGINE_ID_PATH = /^(participants|kept)\[(\d+)\]\.id$/;

/** Names the request field (`reference`) where the engine reports its own `id`. */
function requestPath(path: string): string {
  return path.replace(ENGINE_ID_PATH, '$1[$2].reference');
}

/** One field error per Zod issue; an unknown key is reported at the key's own path. */
function issueFields(issue: z.core.$ZodIssue): FieldError[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: formatPath([...issue.path, key]),
      message: 'This field is not recognised.',
    }));
  }
  return [{ path: formatPath(issue.path), message: issue.message }];
}

function invalidFields(fields: FieldError[]) {
  return unprocessable('INVALID_ENGINE_INPUT', 'Some fields are not valid.', { fields });
}

/** The X-Orbyte-App-Id header without control characters, at most 64 characters; null when absent. */
export function cleanAppId(request: Request): string | null {
  const raw = request.headers.get('x-orbyte-app-id');
  if (raw === null) return null;
  return raw.replace(/[\x00-\x1f\x7f]/g, '').slice(0, MAX_APP_ID_LENGTH);
}

function logAppId(request: Request, operation: string): void {
  const id = cleanAppId(request);
  if (id === null) return;
  console.info(`[engine-api] app=${id} op=${operation}`);
}

/** Reads and validates the JSON body, runs the engine, and answers with JSON. */
async function handle<TIn, TOut>(
  request: Request,
  operation: string,
  schema: ZodType<TIn>,
  run: (input: TIn) => TOut,
): Promise<Response> {
  try {
    logAppId(request, operation);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return toErrorResponse(badRequest('The request body must be valid JSON.'));
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return toErrorResponse(invalidFields(parsed.error.issues.flatMap(issueFields)));
    }
    try {
      return json(run(parsed.data));
    } catch (error) {
      if (error instanceof EngineInputError) {
        return toErrorResponse(
          invalidFields(error.fields.map((f) => ({ ...f, path: requestPath(f.path) }))),
        );
      }
      throw error;
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

export function handleQuote(request: Request): Promise<Response> {
  return handle(request, 'quote', quoteSchema, (input) => quote(input));
}

export function handleCloseRound(request: Request): Promise<Response> {
  return handle(request, 'close-round', closeRoundSchema, (input) => {
    const result = closeRound({
      tiers: input.tiers,
      feeBps: input.feeBps,
      ...(input.unitName !== undefined ? { unitName: input.unitName } : {}),
      participants: input.participants.map(({ reference, priceLimitSen, ...rest }) => ({
        ...rest,
        id: reference,
        priceLimitSen: priceLimitSen ?? null,
      })),
    });
    return {
      ...result,
      participants: result.participants.map(({ id, ...rest }) => ({ reference: id, ...rest })),
    };
  });
}

export function handleAllocateShortfall(request: Request): Promise<Response> {
  return handle(request, 'allocate-shortfall', allocateShortfallSchema, (input) => {
    const result = allocateShortfall({
      kept: input.kept.map(({ reference, ...rest }) => ({ ...rest, id: reference })),
      goodUnitsReceived: input.goodUnitsReceived,
      finalGoodsPriceSen: input.finalGoodsPriceSen,
    });
    return {
      ...result,
      allocations: result.allocations.map(({ id, ...rest }) => ({ reference: id, ...rest })),
    };
  });
}
