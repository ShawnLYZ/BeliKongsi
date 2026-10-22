export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503;

export class AppError extends Error {
  constructor(
    public code: string,
    public status: ErrorStatus,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError('INVALID_INPUT', 400, message, details);
export const unauthorized = () => new AppError('UNAUTHORIZED', 401, 'Please sign in.');
export const forbidden = (message = 'You do not have access to this.') =>
  new AppError('FORBIDDEN', 403, message);
export const notFound = (what: string) => new AppError('NOT_FOUND', 404, `${what} was not found.`);
export const conflict = (code: string, message: string) => new AppError(code, 409, message);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(code, 422, message, details);
export const rateLimited = () =>
  new AppError('RATE_LIMITED', 429, 'Too many requests. Please try again shortly.');
export const aiUnavailable = (details?: unknown) =>
  new AppError('AI_UNAVAILABLE', 503, 'The assistant is unavailable right now.', details);

export function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const body: { code: string; message: string; details?: unknown } = {
      code: error.code,
      message: error.message,
    };
    if (error.details !== undefined) body.details = error.details;
    return Response.json(body, { status: error.status });
  }
  console.error('Unhandled error', error);
  return Response.json({ code: 'INTERNAL', message: 'Something went wrong.' }, { status: 500 });
}
