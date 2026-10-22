import { toast } from 'sonner';

/** An error answer from the BeliKongsi API, in its one error shape `{ code, message, details? }`. */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiInit = Omit<RequestInit, 'body'> & {
  /** Sent as JSON. */
  body?: unknown;
  /** Skip the error toast (the caller shows the error itself). */
  quiet?: boolean;
};

export type ApiFetchDeps = {
  fetch: typeof fetch;
  notify: (message: string) => void;
  newKey: () => string;
};

const NETWORK_MESSAGE = 'Could not reach BeliKongsi. Check your connection and try again.';
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

function toApiError(status: number, data: unknown): ApiError {
  if (data && typeof data === 'object') {
    const { code, message, details } = data as Record<string, unknown>;
    if (typeof code === 'string' && typeof message === 'string') {
      return new ApiError(code, message, status, details);
    }
  }
  return new ApiError('INTERNAL', FALLBACK_MESSAGE, status);
}

export function createApiFetch(deps: ApiFetchDeps) {
  return async function apiFetch<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
    const { body, quiet, headers, method: rawMethod, ...rest } = init;
    const method = (rawMethod ?? (body === undefined ? 'GET' : 'POST')).toUpperCase();
    const h = new Headers(headers);
    h.set('Accept', 'application/json');
    if (body !== undefined) h.set('Content-Type', 'application/json');
    // A retried click must not decide or reset twice (PRD §20: retries carry an idempotency key).
    if (method === 'POST' && !h.has('Idempotency-Key')) h.set('Idempotency-Key', deps.newKey());

    const fail = (error: ApiError): never => {
      if (!quiet) deps.notify(error.message);
      throw error;
    };

    let res: Response;
    try {
      res = await deps.fetch(path, {
        ...rest,
        method,
        headers: h,
        credentials: 'same-origin',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return fail(new ApiError('NETWORK', NETWORK_MESSAGE, 0));
    }

    const text = await res.text();
    let data: unknown = null;
    if (text !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) return fail(toApiError(res.status, data));
    return data as T;
  };
}

/** JSON calls to the BeliKongsi API from client components; errors also show as a toast. */
export const apiFetch = createApiFetch({
  fetch: (input, init) => fetch(input, init),
  notify: (message) => toast.error(message),
  newKey: () => crypto.randomUUID(),
});
