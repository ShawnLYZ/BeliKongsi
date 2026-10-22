import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { json, route } from '@/server/platform/http';

const noSchema = route({ auth: 'public', maxBodyBytes: 100 }, async ({ request }) => {
  const buf = await request.arrayBuffer();
  return json({ read: buf.byteLength });
});
const withSchema = route(
  { auth: 'public', maxBodyBytes: 100, body: z.object({ a: z.string() }) },
  async ({ body }) => json({ a: body.a.length }),
);

function streamed(text: string, headers: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(c) {
      c.enqueue(bytes.slice(0, 60));
      c.enqueue(bytes.slice(60));
      c.close();
    },
  });
  return new Request('http://localhost/x', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
}

describe('body size limit', () => {
  for (const [name, handler, ok, big] of [
    ['no schema', noSchema, 'y'.repeat(50), 'y'.repeat(500)],
    [
      'schema',
      withSchema,
      JSON.stringify({ a: 'y'.repeat(20) }),
      JSON.stringify({ a: 'y'.repeat(500) }),
    ],
  ] as const) {
    describe(name, () => {
      it('accepts a body within the limit', async () => {
        expect((await handler(streamed(ok))).status).toBe(200);
      });
      it('rejects an over-limit Content-Length before the handler runs', async () => {
        const res = await handler(streamed(big, { 'content-length': '500' }));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('BODY_TOO_LARGE');
      });
      it('rejects a streamed body with no Content-Length', async () => {
        const res = await handler(streamed(big));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('BODY_TOO_LARGE');
      });
      it('rejects a streamed body with an understated Content-Length', async () => {
        const res = await handler(streamed(big, { 'content-length': '10' }));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('BODY_TOO_LARGE');
      });
    });
  }

  it('refuses idempotent with public auth at definition time', () => {
    expect(() => route({ auth: 'public', idempotent: true }, async () => json({}))).toThrow();
  });
});
