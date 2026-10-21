import { afterEach, describe, expect, it, vi } from 'vitest';
import { badRequest, conflict, notFound, toErrorResponse } from '@/server/platform/errors';

afterEach(() => vi.restoreAllMocks());

describe('toErrorResponse', () => {
  it('turns an AppError into the one error shape', async () => {
    const res = toErrorResponse(conflict('ROUND_CLOSED', 'This round has already closed.'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: 'ROUND_CLOSED',
      message: 'This round has already closed.',
    });
  });

  it('includes details when present', async () => {
    const res = toErrorResponse(badRequest('Bad.', { field: 'x' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'INVALID_INPUT',
      message: 'Bad.',
      details: { field: 'x' },
    });
    expect(notFound('Round').status).toBe(404);
  });

  it('hides unexpected errors behind a 500 and logs the cause', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = toErrorResponse(new Error('db password is hunter2'));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('hunter2');
    expect(JSON.parse(text)).toEqual({ code: 'INTERNAL', message: 'Something went wrong.' });
    expect(spy).toHaveBeenCalled();
  });
});
