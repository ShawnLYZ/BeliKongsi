import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { runDueJobs } from '@/server/modules/jobs/run';
import { sendMonthlySummaries } from '@/server/modules/savings/monthly-summary';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { insertParticipation, insertShop } from './helpers/builders';
import {
  allocationOf,
  basketIdOf,
  consignmentFor,
  moveConsignment,
  payBasket,
  pickupOf,
  roundOf,
  setupKedaiKopi,
  toHubChecked,
  uploadPhoto,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const WEEK = '2026-W45';
const DATE = '2026-11-10';
const KEDAI_ROUNDS = ['EM', 'CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];
const TYPE = 'savings.monthly_summary';
const AH_SENG = seedId('user', 'ahSeng');

let app: TestApp;
let ah: Client;
let refundsBeforeCheckSen: number;

const rm = (sen: number) =>
  `RM ${(sen / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Sets the effective time (the demo clock offset is subtracted so the app sees exactly `iso`). */
async function setNow(iso: string) {
  const settings = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
  const offset = settings.demoMode ? Number(settings.clockOffsetMs) : 0;
  app.clock.set(new Date(Date.parse(iso) - offset).toISOString());
}
const summariesOf = (userId: string) =>
  app.prisma.notification.findMany({ where: { type: TYPE, userId } });

/** Kedai Kopi's week as in savings.test.ts: 6 cartons of condensed milk, 1 arrived damaged, claim approved. */
beforeAll(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  const basketId = (await basketIdOf('KEDAI_KOPI', WEEK))!;
  const added = await (
    await app.as('rahim')
  ).post(`/api/baskets/${basketId}/lines`, { productId: seedId('product', 'EM'), quantity: 1 });
  expect(added.status).toBe(200);
  await payBasket(app, 'ahSeng', basketId);
  ah = await app.as('ahSeng');
  await toHubChecked(app, KEDAI_ROUNDS);
  for (const hub of ['HUB_KV', 'HUB_JOHOR']) {
    const c = await consignmentFor({ hub, destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE });
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
  }
  const p = await pickupOf('KEDAI_KOPI', DATE);
  const rahim = await app.as('rahim');
  expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
  refundsBeforeCheckSen = (await ah.get(`/api/shops/${KEDAI}/savings?month=2026-11`)).body
    .refundsSen;

  const settings = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
  app.clock.set(
    new Date(Date.parse('2026-11-30T15:30:00Z') - Number(settings.clockOffsetMs)).toISOString(),
  );
  const photo = await uploadPhoto(rahim, p.id);
  const cmAlloc = (await allocationOf('KEDAI_KOPI', 'CM')).id;
  const res = await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
    lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] }],
  });
  expect(res.status).toBe(200);
  const claim = await app.prisma.claim.findUniqueOrThrow({ where: { id: res.body.claimId } });
  const approved = await (
    await app.as('nadia')
  ).post(`/api/approvals/${claim.approvalRequestId!}/approve`, {});
  expect(approved.status).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe('the monthly summary', () => {
  it('waits until 09:00 Malaysia time on the 1st', async () => {
    await setNow('2026-12-01T00:59:00Z');
    expect(await sendMonthlySummaries(app.deps)).toEqual({ sent: 0 });
    await setNow('2026-11-30T16:00:00Z');
    expect(await sendMonthlySummaries(app.deps)).toEqual({ sent: 0 });
    expect(await app.prisma.notification.count({ where: { type: TYPE } })).toBe(0);
  });

  it("sends November's summary on 1 December at 09:00, once (story 89)", async () => {
    await setNow('2026-12-01T01:00:00Z');
    await sendMonthlySummaries(app.deps);
    await sendMonthlySummaries(app.deps);
    const n = await summariesOf(AH_SENG);
    expect(n).toHaveLength(1);
    expect(n[0]!.whatsappText).toMatch(
      /^Your BeliKongsi summary for November: \d+ rounds, \d+ units, RM [\d,.]+ refunded, RM [\d,.]+ in fees, RM [\d,.]+ verified savings\.$/,
    );
  });

  it('states the exact figures of the month', async () => {
    const parts = await app.prisma.participation.findMany({
      where: { shopId: KEDAI, finalAllInSen: { not: null }, status: 'closed' },
    });
    const allocs = await app.prisma.allocation.findMany({
      where: { participationId: { in: parts.map((p) => p.id) } },
      include: { checkLines: true },
    });
    let fees = 0;
    let saved = 0;
    for (const p of parts) {
      const a = allocs.find((x) => x.participationId === p.id)!;
      const line = a.checkLines[0]!;
      fees += a.allocated * p.finalFeeSen!;
      saved += (p.baselineSen - p.finalAllInSen!) * (a.allocated - line.missing - line.damaged);
    }
    expect(parts).toHaveLength(6);
    const refunds = refundsBeforeCheckSen + 15185;
    const [n] = await summariesOf(AH_SENG);
    expect(n!.whatsappText).toBe(
      `Your BeliKongsi summary for November: 6 rounds, 22 units, ${rm(refunds)} refunded, ${rm(fees)} in fees, ${rm(saved)} verified savings.`,
    );
  });

  it('sends nothing for a month with no participation', async () => {
    await setNow('2027-01-01T01:00:00Z');
    expect(await sendMonthlySummaries(app.deps)).toEqual({ sent: 0 });
  });

  it('catches up later in the month, and skips background shops', async () => {
    const round = await roundOf('CM', WEEK);
    const owners: string[] = [];
    for (const [name, isBackground] of [
      ['Late Real', false],
      ['Late Background', true],
    ] as const) {
      const built = await insertShop(app.prisma, { lat: 4.6, lng: 101.08, name });
      await app.prisma.shop.update({ where: { id: built.shopId }, data: { isBackground } });
      const part = await insertParticipation(app.prisma, {
        roundId: round.id,
        shopId: built.shopId,
        quantity: 2,
        unitShippingSen: 0,
      });
      await app.prisma.participation.update({
        where: { id: part.id },
        data: { finalAllInSen: 15000, status: 'kept' },
      });
      await app.prisma.allocation.create({
        data: { participationId: part.id, allocated: 2, missing: 0 },
      });
      owners.push(built.userId);
    }
    await setNow('2026-12-15T04:00:00Z');
    expect(await sendMonthlySummaries(app.deps)).toEqual({ sent: 1 });
    expect(await summariesOf(owners[0]!)).toHaveLength(1);
    expect(await summariesOf(owners[1]!)).toHaveLength(0);
    expect(await summariesOf(AH_SENG)).toHaveLength(1);
  });

  it('is part of the due jobs report', async () => {
    await setNow('2026-12-15T05:00:00Z');
    expect((await runDueJobs(app.deps)).monthlySummaries).toBe(0);
  });
});
