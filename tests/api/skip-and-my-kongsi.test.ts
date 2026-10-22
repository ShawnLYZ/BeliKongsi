import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { basketIdOf, openRoundOf, payBasket, setupKedaiKopi } from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const WEEK = '2026-W45';

type Row = {
  participationId: string;
  shortName: string;
  status: string;
  finalAllInSen: number | null;
};

let app: TestApp;
let ah: Client;

const offsetMs = async () =>
  Number((await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } })).clockOffsetMs);

afterEach(async () => {
  await app.close();
});

describe('skip to cut-off and My Kongsi', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await setupKedaiKopi(app);
    await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', WEEK))!);
    ah = await app.as('ahSeng');
  });

  it('moves the clock to the first cut-off and closes the rounds (story 164)', async () => {
    const res = await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
    expect(res.status).toBe(200);
    expect(res.body.now).toBe('2026-11-05T12:01:00.000Z');
    expect(res.body.closed).toBe(12);
    expect(res.body.offsetMs).toBe(
      new Date('2026-11-05T12:01:00Z').getTime() - app.clock.now().getTime(),
    );
    expect(
      await app.prisma.round.count({
        where: { status: 'open', cutoffAt: { lt: new Date('2026-11-06') } },
      }),
    ).toBe(0);
    const logged = await app.prisma.activityLogEntry.findFirst({
      where: { action: 'demo.skip_to_cutoff' },
    });
    expect(logged).not.toBeNull();
  });

  it('voids a join payment still pending for a round it closed, as the jobs would', async () => {
    const roundId = (await openRoundOf('CM')).id;
    const joined = await (
      await app.as('mei')
    ).post(`/api/rounds/${roundId}/participations`, { quantity: 1 });
    expect(joined.body).toMatchObject({ status: 'pending' });
    const res = await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
    expect(res.status).toBe(200);
    expect(
      (await app.prisma.payment.findUniqueOrThrow({ where: { id: joined.body.paymentId } })).status,
    ).toBe('voided');
    expect(res.body).toMatchObject({ closed: 12, failed: 0 });
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  });

  it('says when there is no open round to skip to, leaving the offset alone', async () => {
    await app.prisma.product.updateMany({ data: { active: false } });
    app.clock.set('2026-11-05T12:01:00Z');
    await closeDueRounds(app.deps);
    expect(await app.prisma.round.count({ where: { status: 'open' } })).toBe(0);
    const before = await offsetMs();
    const res = await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe('NO_OPEN_ROUND');
    expect(await offsetMs()).toBe(before);
  });

  it('needs demo mode for skipping', async () => {
    await app.adminQuery('update demo_settings set demo_mode = false');
    const res = await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
    expect(res.status).toBe(404);
    expect(res.body.error?.code ?? res.body.code).toBe('DEMO_OFF');
  });

  it("lists the owner's results with refunds (story 67)", async () => {
    const before = (await ah.get(`/api/shops/${KEDAI}/participations?status=active`)).body.items;
    expect(before.length).toBe(5);
    expect(before.every((i: Row) => i.status === 'active' && i.finalAllInSen === null)).toBe(true);
    expect((await ah.get(`/api/shops/${KEDAI}/participations?status=history`)).body.items).toEqual(
      [],
    );

    await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
    const items = (await ah.get(`/api/shops/${KEDAI}/participations?status=history`)).body.items;
    expect(items.find((i: Row) => i.shortName === 'condensed milk')).toMatchObject({
      status: 'kept',
      paidSen: 98454,
      finalAllInSen: 15185,
      refundSen: 7344,
    });
    expect((await ah.get(`/api/shops/${KEDAI}/participations?status=active`)).body.items).toEqual(
      [],
    );
  });

  it('pages the list with a cursor', async () => {
    await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
    const first = (await ah.get(`/api/shops/${KEDAI}/participations?status=history&limit=2`)).body;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await ah.get(
        `/api/shops/${KEDAI}/participations?status=history&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      )
    ).body;
    const ids = [...first.items, ...second.items].map((i: Row) => i.participationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.items.length).toBeGreaterThan(0);
  });

  it('shows the list to the owner only', async () => {
    const staff = await app.as('rahim');
    expect((await staff.get(`/api/shops/${KEDAI}/participations?status=active`)).status).toBe(403);
    const other = await app.as('siti');
    expect((await other.get(`/api/shops/${KEDAI}/participations?status=active`)).status).toBe(404);
  });
});
