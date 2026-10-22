import { z, type ZodType } from 'zod';
import type { Role } from '@/generated/prisma/client';
import { personCaller, type Caller } from './caller';
import { getDeps, type AppDeps } from './deps';
import { AppError, badRequest, forbidden, toErrorResponse, unauthorized } from './errors';
import { withIdempotency } from './idempotency';
import { loadSession, type Session } from './session';

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

/** 'public' loads no session; 'session' needs any signed-in person; a Role[] also checks the role. */
export type RouteAuth = 'public' | 'session' | readonly Role[];

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Server-to-server surfaces: no browser cookie is involved, so there is no CSRF to guard.
const ORIGIN_EXEMPT = ['/api/engine/v1/', '/api/jobs/'];

interface RouteOptions<TBody, TQuery, TAuth extends RouteAuth> {
  auth: TAuth;
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  /** Wraps the handler in withIdempotency, keyed by the Idempotency-Key header. JSON responses only. */
  idempotent?: boolean;
  /** Largest request body, in bytes. Defaults to 1 MiB; photo endpoints use 8 MiB. */
  maxBodyBytes?: number;
}

// Public routes get no session and no caller (null), so they cannot act as anyone by accident.
interface RouteArgs<TBody, TQuery, TAuth extends RouteAuth> {
  request: Request;
  deps: AppDeps;
  params: Record<string, string>;
  body: TBody;
  query: TQuery;
  session: TAuth extends 'public' ? null : Session;
  caller: TAuth extends 'public' ? null : Caller;
}

type NextContext = { params?: Promise<Record<string, string | string[]>> };

function invalid(fieldErrors: unknown): Response {
  return toErrorResponse(badRequest('The request was not valid.', { fieldErrors }));
}

const tooLarge = () => new AppError('BODY_TOO_LARGE', 400, 'The request body is too large.');

/** Reads the body as JSON, stopping as soon as it passes the limit (Content-Length may be absent or wrong). */
async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const reader = request.body?.getReader();
  if (!reader) throw badRequest('The request body must be valid JSON.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('The request body must be valid JSON.');
  }
}

/**
 * Handlers without a body schema receive this request: reading its body fails (and the wrapper
 * answers 400 BODY_TOO_LARGE) as soon as more than maxBytes have been read, whatever
 * Content-Length said.
 */
function boundRequest(request: Request, maxBytes: number) {
  let over = false;
  if (!request.body) return { request, exceeded: () => false };
  let size = 0;
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        over = true;
        controller.error(tooLarge());
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const wrapped = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body.pipeThrough(limit),
    duplex: 'half',
    signal: request.signal,
  } as RequestInit);
  return { request: wrapped, exceeded: () => over };
}

function checkOrigin(request: Request): void {
  if (!MUTATING.has(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin === null) return;
  const url = new URL(request.url);
  if (ORIGIN_EXEMPT.some((prefix) => url.pathname.startsWith(prefix))) return;
  if (origin !== url.origin) {
    throw new AppError('CROSS_ORIGIN', 403, 'This request came from another site.');
  }
}

export function route<TBody = unknown, TQuery = unknown, TAuth extends RouteAuth = 'public'>(
  options: RouteOptions<TBody, TQuery, TAuth>,
  handler: (args: RouteArgs<TBody, TQuery, TAuth>) => Promise<Response>,
) {
  if (options.idempotent && options.auth === 'public') {
    // Every anonymous caller would share one replay scope.
    throw new Error("route: 'idempotent' needs a signed-in auth ('session' or a role list).");
  }
  const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  return async (request: Request, context?: NextContext): Promise<Response> => {
    let exceeded: () => boolean = () => false;
    try {
      checkOrigin(request);

      // Every request with a body is bounded, schema or not: Content-Length is checked here, and
      // routes without a body schema get a request whose stream errors once it passes the limit.
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
      const bounded = options.body ? null : boundRequest(request, maxBytes);
      if (bounded) request = bounded.request;
      exceeded = bounded?.exceeded ?? (() => false);

      // Resolved on first access, so handlers that never use deps need no environment.
      let cached: AppDeps | undefined;
      const lazyDeps = () => (cached ??= getDeps());

      let session: Session | null = null;
      if (options.auth !== 'public') {
        session = await loadSession(lazyDeps(), request);
        if (!session) throw unauthorized();
        if (Array.isArray(options.auth) && !options.auth.includes(session.membership.role)) {
          throw forbidden();
        }
      }

      const rawParams = (await context?.params) ?? {};
      const params = Object.fromEntries(
        Object.entries(rawParams).map(([k, v]) => [k, Array.isArray(v) ? v.join('/') : v]),
      );

      let body = undefined as TBody;
      if (options.body) {
        const raw = await readJsonBody(request, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
        const parsed = options.body.safeParse(raw);
        if (!parsed.success) return invalid(z.flattenError(parsed.error).fieldErrors);
        body = parsed.data;
      }

      let query = undefined as TQuery;
      if (options.query) {
        const raw = Object.fromEntries(new URL(request.url).searchParams);
        const parsed = options.query.safeParse(raw);
        if (!parsed.success) return invalid(z.flattenError(parsed.error).fieldErrors);
        query = parsed.data;
      }

      const args = {
        request,
        get deps() {
          return lazyDeps();
        },
        params,
        body,
        query,
        session,
        caller: session ? personCaller(session) : null,
      } as RouteArgs<TBody, TQuery, TAuth>;

      if (!options.idempotent) return await handler(args);

      const { pathname } = new URL(request.url);
      const scope = `${session?.userId ?? 'anonymous'}:${request.method}:${pathname}`;
      const stored = await withIdempotency(
        lazyDeps(),
        scope,
        request.headers.get('idempotency-key'),
        async () => {
          const response = await handler(args);
          const text = await response.text();
          return { status: response.status, body: text === '' ? null : JSON.parse(text) };
        },
      );
      // A replay returns the stored status and body; headers such as Set-Cookie are not replayed.
      return stored.body === null
        ? new Response(null, { status: stored.status })
        : Response.json(stored.body, { status: stored.status });
    } catch (error) {
      // A body reader may wrap the stream error (formData, arrayBuffer), so go by the flag.
      return toErrorResponse(exceeded() ? tooLarge() : error);
    }
  };
}
