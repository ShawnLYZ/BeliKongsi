import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { createTestApp, type TestApp } from './helpers/app';
import { basketOf, totalsByProductKey } from './helpers/scenarios';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp({ seed: 'demo' });
});
afterAll(async () => {
  await app.close();
});

/** A shop's lines in the rounds of one cycle. */
const participationsOf = (shopKey: string, cycleLabel: string) =>
  app.prisma.participation.findMany({
    where: { shopId: seedId('shop', shopKey), round: { cycleLabel } },
  });

describe('the seeded history week', () => {
  it('has a completed previous week for Gerai, Kafe and the background shops', async () => {
    expect(
      await app.prisma.round.count({
        where: { cycleLabel: '2026-W44', status: { in: ['completed', 'failed'] } },
      }),
    ).toBe(8);
    const gerai = await participationsOf('GERAI', '2026-W44');
    expect(gerai).toHaveLength(3);
    expect(gerai.every((p) => p.status === 'closed')).toBe(true);
  });

  it('leaves the demo week on its designed totals', async () => {
    expect(await totalsByProductKey(app)).toEqual({
      CM: 99,
      EM: 57,
      OIL: 104,
      FLOUR: 25,
      COFFEE: 29,
      TEA: 6,
      EGG_A: 320,
      EGG_B: 130,
      CUPS: 29,
      CONT: 15,
      BAGS: 51,
      KRAFT: 0,
    });
  });

  it('answers an old checkout link with 404 after a reset', async () => {
    const siti = await app.as('siti');
    const week = (await (await app.as('nadia')).get('/api/demo/state')).body.basketWeek as string;
    const { id: basketId } = await basketOf('GERAI', week);
    const old = await app.prisma.payment.findFirstOrThrow({ where: { basketId } });
    expect((await siti.get(`/api/payments/${old.id}`)).status).toBe(200);

    expect((await (await app.as('nadia')).post('/api/demo/reset')).status).toBe(200);
    const res = await siti.get(`/api/payments/${old.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: 'Payment was not found.' });
  });
});
