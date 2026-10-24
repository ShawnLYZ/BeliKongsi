import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { setDepsForTests, type AppDeps } from '@/server/platform/deps';
import { createPrismaClient } from '@/server/platform/db';
import { createFakeOrderReader } from '@/server/adapters/ai/fake';
import { systemClock } from '@/server/adapters/clock';
import { createLocalStorage } from '@/server/adapters/storage/local';
import { simulatedLogistics } from '@/server/adapters/logistics';
import { simulatedPayments } from '@/server/adapters/payments';
import { callRoute } from './helpers/route';
import { createTestDatabase } from './helpers/db';

const clients: PrismaClient[] = [];

function depsFor(url: string): AppDeps {
  const prisma = createPrismaClient(url);
  clients.push(prisma);
  return {
    prisma,
    env: {
      DATABASE_URL: url,
      SESSION_SECRET: 'a-session-secret-that-is-long-enough-0123456789',
      CRON_SECRET: 'a-cron-secret-1234',
      DEMO_MODE: true,
      AI_ADAPTER: 'fake',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      STORAGE_ADAPTER: 'local',
      LOCAL_STORAGE_DIR: '.data/storage',
    },
    clock: systemClock,
    logistics: simulatedLogistics,
    payments: simulatedPayments,
    ai: createFakeOrderReader(),
    storage: createLocalStorage({ dir: tmpdir() }),
    http: {
      fetch: () => Promise.reject(new Error('Network access is off in tests.')),
      lookup: async () => ['93.184.216.34'],
    },
  };
}

afterEach(async () => {
  setDepsForTests(null);
  await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
});

describe('GET /api/health', () => {
  it('reports ok when the database answers as the app role', async () => {
    const db = await createTestDatabase();
    try {
      setDepsForTests(depsFor(db.appUrl));
      expect(await callRoute('GET', '/api/health')).toMatchObject({
        status: 200,
        body: { status: 'ok', database: 'ok' },
      });
    } finally {
      setDepsForTests(null);
      await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
      await db.drop();
    }
  });

  it('reports the database as unreachable without leaking the URL', async () => {
    setDepsForTests(depsFor('postgresql://bk_app:bk_app_test@localhost:1/nowhere'));
    const res = await callRoute('GET', '/api/health');
    expect(res).toMatchObject({
      status: 503,
      body: { status: 'degraded', database: 'unreachable' },
    });
    expect(JSON.stringify(res.body)).not.toContain('bk_app_test');
  });
});
