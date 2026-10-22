import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { createTestApp, type TestApp } from './helpers/app';
import { basketIdOf, payBasket, setupKedaiKopi } from './helpers/scenarios';

const WEEK = '2026-W45';

let app: TestApp;

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', WEEK))!);
  app.clock.set('2026-11-05T12:01:00Z');
  await closeDueRounds(app.deps);
});

afterEach(async () => {
  await app.close();
});

describe('Ops integration events feed', () => {
  it('lets only Ops see the latest 100 events (story 132)', async () => {
    expect((await (await app.as('ahSeng')).get('/api/ops/events')).status).toBe(403);
    const ev = (await (await app.as('nadia')).get('/api/ops/events')).body.items;
    expect(ev.length).toBeLessThanOrEqual(100);
    expect(ev.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['round.closed', 'refund.issued', 'participation.dropped']),
    );
  });

  it('never carries a business or person name in event data (PRD §21)', async () => {
    const s = JSON.stringify((await (await app.as('nadia')).get('/api/ops/events')).body);
    expect(s).not.toMatch(/Contoh|Ah Seng|Siti|Mei/);
  });
});
