import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { createTestApp, type TestApp } from './helpers/app';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const RAHIM = seedId('user', 'rahim');

describe('simulated sign-in and sessions', () => {
  it('signs in as a seeded owner with a signed, HTTP-only cookie', async () => {
    const res = await app
      .anonymous()
      .post('/api/session', { userId: seedId('user', 'ahSeng'), provider: 'microsoft' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(
      /bk_session=.+; Path=\/; .*HttpOnly; .*SameSite=Lax/i,
    );
    expect(res.body.activeMembership).toMatchObject({
      role: 'owner',
      orgName: 'Kedai Kopi Contoh',
    });
  });

  it('answers GET with the session view, and 401 with no cookie', async () => {
    const c = await app.as('rahim');
    const res = await c.get('/api/session');
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(RAHIM);
    expect(res.body.memberships).toHaveLength(1);
    expect((await app.anonymous().get('/api/session')).status).toBe(401);
  });

  it('answers 404 for an unknown user', async () => {
    const res = await app.anonymous().post('/api/session', {
      userId: '00000000-0000-4000-8000-000000000000',
      provider: 'google',
    });
    expect(res.status).toBe(404);
  });

  it('clears the cookie on DELETE', async () => {
    const c = await app.as('rahim');
    const res = await c.delete('/api/session');
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect((await c.get('/api/session')).status).toBe(401);
  });

  it('rejects a tampered cookie with 401', async () => {
    const c = await app.as('rahim');
    c.tamperCookie(); // swaps the user id in the payload, keeps the old signature
    expect((await c.get('/api/session')).status).toBe(401);
  });

  it('rejects a cookie older than 7 days of real time', async () => {
    const { signSessionValue } = await import('@/server/platform/session');
    const value = signSessionValue(
      {
        u: RAHIM,
        m: seedId('membership', 'rahim'),
        iat: Math.floor(Date.now() / 1000) - 8 * 24 * 3600,
      },
      app.deps.env.SESSION_SECRET,
    );
    const res = await app.anonymous().get('/api/session', undefined, {
      cookie: `bk_session=${value}`,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a validly signed cookie whose membership belongs to another user', async () => {
    const { signSessionValue } = await import('@/server/platform/session');
    const value = signSessionValue(
      {
        u: RAHIM,
        m: seedId('membership', 'ahSeng'),
        iat: Math.floor(Date.now() / 1000),
      },
      app.deps.env.SESSION_SECRET,
    );
    const res = await app.anonymous().get('/api/session', undefined, {
      cookie: `bk_session=${value}`,
    });
    expect(res.status).toBe(401);
  });

  it('treats an ended membership as signed out', async () => {
    const c = await app.as('priya');
    await app.adminQuery('update memberships set ended_at = now() where id = $1', [
      seedId('membership', 'priya'),
    ]);
    expect((await c.get('/api/session')).status).toBe(401);
    await app.adminQuery('update memberships set ended_at = null where id = $1', [
      seedId('membership', 'priya'),
    ]);
  });

  it('switches between the user’s own memberships only', async () => {
    const ah = await app.as('ahSeng');
    expect(
      (
        await ah.post('/api/session/active-membership', {
          membershipId: seedId('membership', 'farid'),
        })
      ).status,
    ).toBe(404);
  });

  it('switches account in demo mode (C6)', async () => {
    const ah = await app.as('ahSeng');
    const r = await ah.post('/api/session/active-membership', { userId: seedId('user', 'nadia') });
    expect(r.body.activeMembership.role).toBe('ops');
    expect((await ah.get('/api/session')).body.user.id).toBe(seedId('user', 'nadia'));
  });

  it('refuses account switching outside demo mode, and another user’s membership', async () => {
    await app.adminQuery('update demo_settings set demo_mode = false where id = 1');
    try {
      const ah = await app.as('ahSeng');
      const byUser = await ah.post('/api/session/active-membership', {
        userId: seedId('user', 'nadia'),
      });
      expect(byUser.status).toBe(404);
      const byMembership = await ah.post('/api/session/active-membership', {
        membershipId: seedId('membership', 'nadia'),
      });
      expect(byMembership.status).toBe(404);
      expect((await ah.get('/api/session')).body.user.id).toBe(seedId('user', 'ahSeng'));
    } finally {
      await app.adminQuery('update demo_settings set demo_mode = true where id = 1');
    }
  });

  it('requires exactly one of membershipId and userId', async () => {
    const ah = await app.as('ahSeng');
    expect((await ah.post('/api/session/active-membership', {})).status).toBe(400);
    expect(
      (
        await ah.post('/api/session/active-membership', {
          membershipId: seedId('membership', 'ahSeng'),
          userId: seedId('user', 'ahSeng'),
        })
      ).status,
    ).toBe(400);
  });

  it('requires a session to switch', async () => {
    const res = await app
      .anonymous()
      .post('/api/session/active-membership', { membershipId: seedId('membership', 'ahSeng') });
    expect(res.status).toBe(401);
  });

  it('refuses a cross-origin request', async () => {
    const ah = await app.as('ahSeng');
    const res = await ah.post(
      '/api/session/active-membership',
      { membershipId: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CROSS_ORIGIN');
  });

  it('refuses a body over 1 MB before parsing it', async () => {
    const res = await app
      .anonymous()
      .post('/api/session', { userId: 'x'.repeat(1_100_000), provider: 'google' });
    expect(res.body.code).toBe('BODY_TOO_LARGE');
    expect(res.status).toBe(400);
  });

  it('logs the sign-in by id, not by name', async () => {
    await app.as('ahSeng');
    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'shell.signed_in' },
    });
    expect(
      JSON.stringify(entry, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    ).not.toContain('Ah Seng');
    expect(entry.subjectId).toBe(seedId('user', 'ahSeng'));
  });

  it('logs a role switch', async () => {
    const ah = await app.as('ahSeng');
    await ah.post('/api/session/active-membership', { userId: seedId('user', 'nadia') });
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'shell.role_switched' } }),
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('sign-in rate limit', () => {
  it('rate-limits sign-in: the 21st POST from one IP within 10 minutes is 429', async () => {
    const limited = await createTestApp({ seed: 'reference' });
    try {
      const body = { userId: seedId('user', 'ahSeng'), provider: 'google' };
      const headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
      for (let i = 0; i < 20; i++) {
        expect((await limited.anonymous().post('/api/session', body, headers)).status).toBe(200);
      }
      expect((await limited.anonymous().post('/api/session', body, headers)).status).toBe(429);
      // A different address has its own bucket.
      expect(
        (
          await limited
            .anonymous()
            .post('/api/session', body, { 'x-forwarded-for': '203.0.113.10' })
        ).status,
      ).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
