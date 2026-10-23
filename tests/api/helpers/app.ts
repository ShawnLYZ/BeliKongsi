/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client as PgClient } from 'pg';
import { seedDemo, seedReferenceData } from '../../../prisma/seed';
import { seedId, type SeedUserKey } from '../../../prisma/seed/ids';
import type { PrismaClient } from '@/generated/prisma/client';
import { createFakeOrderReader } from '@/server/adapters/ai/fake';
import { fixedClock, type MutableClock } from '@/server/adapters/clock';
import { createLocalStorage } from '@/server/adapters/storage/local';
import { simulatedLogistics } from '@/server/adapters/logistics';
import { simulatedPayments } from '@/server/adapters/payments';
import { systemCaller } from '@/server/platform/caller';
import { createPrismaClient } from '@/server/platform/db';
import { setDepsForTests, type AppDeps } from '@/server/platform/deps';
import { withTransaction } from '@/server/platform/tx';
import { createTestDatabase, type TestDatabase } from './db';
import { callRoute } from './route';

export async function createTestDeps(opts: { now?: string } = {}): Promise<{
  deps: AppDeps;
  db: TestDatabase;
  clock: MutableClock;
  close(): Promise<void>;
}> {
  const db = await createTestDatabase();
  const prisma = createPrismaClient(db.appUrl);
  const clock = fixedClock(opts.now ?? '2026-11-01T22:05:00Z');
  const storageDir = mkdtempSync(join(tmpdir(), 'bk-test-storage-'));
  const deps: AppDeps = {
    prisma,
    clock,
    logistics: simulatedLogistics,
    payments: simulatedPayments,
    ai: createFakeOrderReader(),
    storage: createLocalStorage({
      dir: storageDir,
      secret: 'a-session-secret-that-is-long-enough-0123456789',
      now: () => clock.now(),
    }),
    env: {
      DATABASE_URL: db.appUrl,
      SESSION_SECRET: 'a-session-secret-that-is-long-enough-0123456789',
      CRON_SECRET: 'a-cron-secret-1234',
      DEMO_MODE: true,
      AI_ADAPTER: 'fake',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      STORAGE_ADAPTER: 'local',
    },
  };
  return {
    deps,
    db,
    clock,
    async close() {
      await prisma.$disconnect();
      await db.drop();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

export type ClientResponse = { status: number; body: any; headers: Headers };

const ORIGIN = 'http://localhost';
const COOKIE_NAME = 'bk_session';

/** A browser stand-in: keeps the session cookie between calls and sends a same-origin Origin. */
export class Client {
  private cookie: string | null = null;

  constructor(private readonly ip?: string) {}

  private async send(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ClientResponse> {
    const h = new Headers({ origin: ORIGIN });
    if (this.ip) h.set('x-forwarded-for', this.ip);
    if (this.cookie) h.set('cookie', `${COOKIE_NAME}=${this.cookie}`);
    for (const [k, v] of Object.entries(headers)) h.set(k, v);
    const res = await callRoute(method, path, {
      ...(body !== undefined ? { body } : {}),
      headers: Object.fromEntries(h),
    });
    const setCookie = res.headers.get('set-cookie');
    const match = setCookie && new RegExp(`${COOKIE_NAME}=([^;]*)`).exec(setCookie);
    if (match) this.cookie = /Max-Age=0/i.test(setCookie) ? null : match[1]!;
    return res;
  }

  get = (path: string, _body?: undefined, headers?: Record<string, string>) =>
    this.send('GET', path, undefined, headers);
  post = (path: string, body?: unknown, headers?: Record<string, string>) =>
    this.send('POST', path, body, headers);
  put = (path: string, body?: unknown, headers?: Record<string, string>) =>
    this.send('PUT', path, body, headers);
  patch = (path: string, body?: unknown, headers?: Record<string, string>) =>
    this.send('PATCH', path, body, headers);
  delete = (path: string, body?: unknown, headers?: Record<string, string>) =>
    this.send('DELETE', path, body, headers);

  switchTo(membershipId: string) {
    return this.post('/api/session/active-membership', { membershipId });
  }

  /** Swaps the user id in the cookie payload but keeps the old signature. */
  tamperCookie(): void {
    if (!this.cookie) throw new Error('no cookie to tamper with');
    const [payload, signature] = this.cookie.split('.');
    const data = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
    data.u = seedId('user', 'ahSeng');
    this.cookie = `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${signature}`;
  }
}

export interface TestApp {
  deps: AppDeps;
  prisma: PrismaClient;
  appUrl: string;
  clock: MutableClock;
  as(user: SeedUserKey): Promise<Client>;
  anonymous(): Client;
  adminQuery(sql: string, params?: unknown[]): Promise<unknown[]>;
  close(): Promise<void>;
}

export async function createTestApp(
  opts: { now?: string; seed?: 'none' | 'reference' | 'demo' } = {},
): Promise<TestApp> {
  const t = await createTestDeps(opts.now ? { now: opts.now } : {});
  const anchorMonday = t.clock.now();
  const seed = opts.seed ?? 'demo';
  if (seed === 'demo') await seedDemo(t.deps, { anchorMonday });
  if (seed === 'reference') {
    await withTransaction(t.deps, systemCaller('seed reference data'), (ctx) =>
      seedReferenceData(ctx, { anchorMonday }),
    );
  }
  setDepsForTests(t.deps);
  let clients = 0;
  return {
    deps: t.deps,
    prisma: t.deps.prisma,
    appUrl: t.db.appUrl,
    clock: t.clock,
    async as(user) {
      // Each signed-in client gets its own address so sign-in rate limits do not couple tests.
      const n = clients++;
      const client = new Client(`10.1.${Math.floor(n / 250)}.${(n % 250) + 1}`);
      const res = await client.post('/api/session', {
        userId: seedId('user', user),
        provider: 'microsoft',
      });
      if (res.status !== 200) throw new Error(`sign-in as ${user} failed: ${res.status}`);
      return client;
    },
    anonymous: () => new Client(),
    async adminQuery(sql, params = []) {
      const client = new PgClient({ connectionString: t.db.adminUrl });
      await client.connect();
      try {
        return (await client.query(sql, params)).rows;
      } finally {
        await client.end();
      }
    },
    async close() {
      setDepsForTests(null);
      await t.close();
    },
  };
}
