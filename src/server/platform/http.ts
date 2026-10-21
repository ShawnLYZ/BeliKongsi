import { z, type ZodType } from 'zod';
import { getDeps, type AppDeps } from './deps';
import { badRequest, toErrorResponse } from './errors';

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

interface RouteOptions<TBody, TQuery> {
  auth: 'public';
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
}

interface RouteArgs<TBody, TQuery> {
  request: Request;
  deps: AppDeps;
  params: Record<string, string>;
  body: TBody;
  query: TQuery;
}

type NextContext = { params?: Promise<Record<string, string | string[]>> };

function invalid(fieldErrors: unknown): Response {
  return toErrorResponse(badRequest('The request was not valid.', { fieldErrors }));
}

export function route<TBody = unknown, TQuery = unknown>(
  options: RouteOptions<TBody, TQuery>,
  handler: (args: RouteArgs<TBody, TQuery>) => Promise<Response>,
) {
  return async (request: Request, context?: NextContext): Promise<Response> => {
    try {
      const rawParams = (await context?.params) ?? {};
      const params = Object.fromEntries(
        Object.entries(rawParams).map(([k, v]) => [k, Array.isArray(v) ? v.join('/') : v]),
      );

      let body = undefined as TBody;
      if (options.body) {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return toErrorResponse(badRequest('The request body must be valid JSON.'));
        }
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

      return await handler({ request, deps: getDeps(), params, body, query });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
