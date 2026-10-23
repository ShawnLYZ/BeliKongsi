import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyLogChain } from '@/server/modules/activity/log';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { createTestApp, type TestApp } from './helpers/app';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp({ seed: 'demo' });
});
afterAll(async () => {
  await app.close();
});

// Timed on its own: the vitest `api-serial` project runs it alone, after the parallel API tests.
describe('resetting the demo data', () => {
  it('resets in under 10 seconds with a valid log and balanced books (story 166)', async () => {
    const nadia = await app.as('nadia');
    const t0 = performance.now();
    const res = await nadia.post('/api/demo/reset');
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    console.info(`demo reset took ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(10_000);
    expect((await verifyLogChain(app.prisma)).valid).toBe(true);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });
});
