import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { mostRecentMonday0605 } from '@/lib/time';
import { verifyLogChain } from '@/server/modules/activity/log';
import { createTestApp, type TestApp } from './helpers/app';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('demo state and reset', () => {
  it('restores the seeded state with a new chain that starts with "demo reset"', async () => {
    const c = await app.as('nadia');
    const res = await c.post('/api/demo/reset');
    expect(res.status).toBe(200);
    const first = await app.prisma.activityLogEntry.findFirstOrThrow({ where: { seq: 1n } });
    expect(first.action).toBe('demo.reset');
    expect(await verifyLogChain(app.prisma)).toMatchObject({ valid: true });
    expect(await app.prisma.shop.count()).toBe(43);
    const settings = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings.lastResetAt).not.toBeNull();
    expect(settings.featuredProductId).toBe(seedId('product', 'CM'));
    expect(res.body.featuredProductId).toBe(seedId('product', 'CM'));
  });

  it('answers 200 to a reset sent with an idempotency key, and replays it', async () => {
    const c = await app.as('nadia');
    const key = { 'Idempotency-Key': 'reset-from-the-demo-menu' };
    const first = await c.post('/api/demo/reset', undefined, key);
    expect(first.status).toBe(200);
    const again = await c.post('/api/demo/reset', undefined, key);
    expect(again.status).toBe(200);
    expect(again.body.featuredProductId).toBe(seedId('product', 'CM'));
  });

  it('ends in the same state when reset twice at once', async () => {
    const c = await app.as('nadia');
    const results = await Promise.all([c.post('/api/demo/reset'), c.post('/api/demo/reset')]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await app.prisma.shop.count()).toBe(43);
    expect((await verifyLogChain(app.prisma)).valid).toBe(true);
    const entries = await app.prisma.activityLogEntry.findMany({ orderBy: { seq: 'asc' } });
    // Seeding the week writes one set of entries: 12 rounds opened, 81 background joins and two
    // paid baskets (83 payments, 89 participations), so the second reset ran on top of the first.
    const count = (action: string) => entries.filter((e) => e.action === action).length;
    expect(count('demo.reset')).toBe(1);
    expect(count('round.opened')).toBe(12);
    expect(count('payment.created')).toBe(83);
    expect(count('payment.succeeded')).toBe(83);
    expect(count('participation.joined')).toBe(89);
    expect(count('basket.drafted')).toBe(2);
    expect(count('basket.approved')).toBe(2);
    expect(entries).toHaveLength(272);
  });

  it('sets the demo clock to the most recent Monday 06:05', async () => {
    const c = await app.as('ahSeng');
    await c.post('/api/demo/reset');
    const res = await c.get('/api/demo/state');
    expect(res.status).toBe(200);
    const expected = mostRecentMonday0605(new Date());
    expect(Math.abs(new Date(res.body.now).getTime() - expected.getTime())).toBeLessThan(5000);
    const cmRound = await app.prisma.round.findFirstOrThrow({
      where: { productId: seedId('product', 'CM'), status: 'open' },
    });
    expect(res.body).toMatchObject({
      demoMode: true,
      featuredProductId: seedId('product', 'CM'),
      featuredRoundId: cmRound.id,
      bannerText: 'Made-up data: every business, person and product here is fictional.',
    });
    expect(res.body.basketWeek).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('sets the offset when seeded by the command line path, so the demo clock reads the anchor', async () => {
    const { resetDemo } = await import('@/server/modules/demo/demo');
    const { systemCaller } = await import('@/server/platform/caller');
    const state = await resetDemo(app.deps, systemCaller('seed demo data'));
    const anchor = mostRecentMonday0605(new Date());
    expect(new Date(state.now).getTime()).toBe(anchor.getTime());
    const first = await app.prisma.activityLogEntry.findFirstOrThrow({ where: { seq: 1n } });
    expect(first.action).toBe('demo.reset');
  });

  it('hides demo controls when demo mode is off', async () => {
    const c = await app.as('nadia');
    await app.adminQuery('update demo_settings set demo_mode = false');
    const reset = await c.post('/api/demo/reset');
    expect(reset.status).toBe(404);
    expect(reset.body.error?.code ?? reset.body.code).toBe('DEMO_OFF');
    expect((await c.get('/api/demo/state')).status).toBe(404);
    expect(await app.prisma.shop.count()).toBe(43);
  });
});
