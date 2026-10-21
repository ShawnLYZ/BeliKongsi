import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { setDepsForTests, type AppDeps } from '@/server/platform/deps';
import { conflict } from '@/server/platform/errors';
import { json, route } from '@/server/platform/http';

const deps = { prisma: {}, env: {} } as unknown as AppDeps;
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

afterEach(() => {
  setDepsForTests(null);
  vi.restoreAllMocks();
});

function post(body: string) {
  return new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('route()', () => {
  it('passes the resolved URL params and the injected deps to the handler', async () => {
    setDepsForTests(deps);
    const handler = route({ auth: 'public' }, async (args) => {
      expect(args.deps).toBe(deps);
      return json({ params: args.params });
    });
    const res = await handler(new Request('http://localhost/x/42'), ctx({ id: '42' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ params: { id: '42' } });
  });

  it('hands the handler a parsed body when the JSON is valid', async () => {
    setDepsForTests(deps);
    const handler = route({ auth: 'public', body: z.object({ name: z.string() }) }, async (a) =>
      json({ got: a.body.name }),
    );
    const res = await handler(post('{"name":"Aisyah"}'), ctx());
    expect(await res.json()).toEqual({ got: 'Aisyah' });
  });

  it('rejects a body that fails the schema with 400 and per-field errors', async () => {
    setDepsForTests(deps);
    const handler = route({ auth: 'public', body: z.object({ name: z.string() }) }, async () =>
      json({}),
    );
    const res = await handler(post('{"name":5}'), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.details.fieldErrors.name).toHaveLength(1);
  });

  it('rejects malformed JSON with 400 INVALID_INPUT', async () => {
    setDepsForTests(deps);
    const handler = route({ auth: 'public', body: z.object({}) }, async () => json({}));
    const res = await handler(post('{not json'), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_INPUT');
  });

  it('parses the query string and reports bad query values as 400', async () => {
    setDepsForTests(deps);
    const handler = route(
      { auth: 'public', query: z.object({ page: z.coerce.number() }) },
      async (a) => json({ page: a.query.page }),
    );
    const ok = await handler(new Request('http://localhost/x?page=3'), ctx());
    expect(await ok.json()).toEqual({ page: 3 });
    const bad = await handler(new Request('http://localhost/x?page=abc'), ctx());
    expect(bad.status).toBe(400);
    expect((await bad.json()).details.fieldErrors.page).toBeDefined();
  });

  it('maps a thrown AppError to its status and code', async () => {
    setDepsForTests(deps);
    const handler = route({ auth: 'public' }, async () => {
      throw conflict('ROUND_CLOSED', 'This round has already closed.');
    });
    const res = await handler(new Request('http://localhost/x'), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: 'ROUND_CLOSED',
      message: 'This round has already closed.',
    });
  });

  it('turns an unexpected error into a generic 500 without leaking it', async () => {
    setDepsForTests(deps);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = route({ auth: 'public' }, async () => {
      throw new Error('secret connection string');
    });
    const res = await handler(new Request('http://localhost/x'), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(JSON.parse(text).code).toBe('INTERNAL');
  });
});
