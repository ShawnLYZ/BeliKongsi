/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { homeSummary } from '@/server/modules/savings/savings';
import { personCaller } from '@/server/platform/caller';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { insertParticipation, insertShop } from './helpers/builders';
import { session } from './helpers/sessions';
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
const GERAI = seedId('shop', 'GERAI');
const WEEK = '2026-W45';
const DATE = '2026-11-10';
const KEDAI_ROUNDS = ['EM', 'CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];

let app: TestApp;
let ah: Client;
let estimatedItems: any[];
let monthBeforeCheck: any;
let claimApproval: string;

const historyItems = async () =>
  (await ah.get(`/api/shops/${KEDAI}/participations?status=history`)).body.items as any[];
const lineOf = (items: any[], shortName: string) => items.find((i) => i.shortName === shortName);
/**
 * Kedai Kopi's kept lines read straight from the tables, so the month's figures can be derived
 * here without the code under test: saving = (baseline - final all-in) x units that arrived.
 */
async function keptLines() {
  const parts = await app.prisma.participation.findMany({
    where: { shopId: KEDAI, finalAllInSen: { not: null }, status: 'closed' },
  });
  const allocs = await app.prisma.allocation.findMany({
    where: { participationId: { in: parts.map((p) => p.id) } },
    include: { checkLines: true },
  });
  return parts.map((p) => {
    const a = allocs.find((x) => x.participationId === p.id)!;
    const line = a.checkLines[0]!;
    const units = a.allocated - line.missing - line.damaged;
    return {
      ...p,
      allocated: a.allocated,
      units,
      savingSen: (p.baselineSen - p.finalAllInSen!) * units,
    };
  });
}
const sumVerified = (items: any[]) =>
  items.filter((i) => i.status === 'verified').reduce((s, i) => s + i.savingSen, 0);

/** Kedai Kopi's week up to the approved claim: 6 cartons of condensed milk, 1 arrived damaged. */
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
  // The goods are collected and checked at 23:30 on 30 November in Malaysia (15:30 UTC), inside the 72-hour window.
  const settings = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
  app.clock.set(
    new Date(Date.parse('2026-11-30T15:30:00Z') - Number(settings.clockOffsetMs)).toISOString(),
  );
  const p = await pickupOf('KEDAI_KOPI', DATE);
  const rahim = await app.as('rahim');
  expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
  estimatedItems = await historyItems();
  monthBeforeCheck = (await ah.get(`/api/shops/${KEDAI}/savings?month=2026-11`)).body;

  const photo = await uploadPhoto(rahim, p.id);
  const cmAlloc = (await allocationOf('KEDAI_KOPI', 'CM')).id;
  const res = await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
    lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] }],
  });
  expect(res.status).toBe(200);
  const claim = await app.prisma.claim.findUniqueOrThrow({ where: { id: res.body.claimId } });
  claimApproval = claim.approvalRequestId!;
  const approved = await (
    await app.as('nadia')
  ).post(`/api/approvals/${claimApproval}/approve`, {});
  expect(approved.status).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe('savings on each line', () => {
  it('shows estimated savings before the check (story 29)', () => {
    expect(lineOf(estimatedItems, 'condensed milk').savings).toEqual({
      savingSen: 1315 * 6,
      unitSavingSen: 1315,
      status: 'estimated',
      basis: 'usual_price',
    });
  });

  it('shows no delivery result before the check', () => {
    expect(lineOf(estimatedItems, 'condensed milk').deliveryResult).toBeNull();
  });

  it('verifies RM 65.75 on condensed milk after 1 damaged carton (stories 82, 85)', async () => {
    expect(lineOf(await historyItems(), 'condensed milk').savings).toEqual({
      savingSen: 6575,
      unitSavingSen: 1315,
      status: 'verified',
      basis: 'usual_price',
    });
  });

  it('reports the delivery result of a checked line', async () => {
    expect(lineOf(await historyItems(), 'condensed milk').deliveryResult).toEqual({
      received: 5,
      missing: 0,
      damaged: 1,
    });
  });

  it('labels a line without a usual price as buying alone (story 86)', async () => {
    const em = lineOf(await historyItems(), 'evaporated milk');
    expect(em.savings.basis).toBe('buy_alone');
  });

  it('shows no savings on a line still waiting for its round to close', async () => {
    const open = await ah.get(`/api/shops/${KEDAI}/participations?status=active`);
    expect(open.body.items.every((i: any) => i.savings === null)).toBe(true);
  });
});

describe('a negative saving against buying alone', () => {
  it('shows the loss honestly and labels the baseline (story 86)', async () => {
    const built = await insertShop(app.prisma, { lat: 4.6, lng: 101.08, name: 'Loss Shop' });
    const round = await roundOf('CM', WEEK);
    const part = await insertParticipation(app.prisma, {
      roundId: round.id,
      shopId: built.shopId,
      quantity: 3,
      unitShippingSen: 0,
    });
    await app.prisma.participation.update({
      where: { id: part.id },
      data: { baselineSen: 15000, baselineKind: 'buy_alone', finalAllInSen: 15185, status: 'kept' },
    });
    await app.prisma.allocation.create({
      data: { participationId: part.id, allocated: 3, missing: 0 },
    });
    const owner = app.anonymous();
    expect(
      (await owner.post('/api/session', { userId: built.userId, provider: 'microsoft' })).status,
    ).toBe(200);
    const items = (await owner.get(`/api/shops/${built.shopId}/participations?status=history`)).body
      .items;
    expect(items[0].savings).toEqual({
      savingSen: -555,
      unitSavingSen: -185,
      status: 'estimated',
      basis: 'buy_alone',
    });
  });
});

describe('the month', () => {
  const month = async (m: string) =>
    (await ah.get(`/api/shops/${KEDAI}/savings?month=${m}`)).body as any;

  it('counts a check at 23:30 MYT on 30 November in November (story 87)', async () => {
    const m = await month('2026-11');
    expect(m.items.find((i: any) => i.productName.includes('condensed milk'))).toMatchObject({
      status: 'verified',
      savingSen: 6575,
    });
  });

  it('does not count that check in December', async () => {
    const m = await month('2026-12');
    expect(m.items).toEqual([]);
  });

  it('sums verified savings of the checked lines, with no delivery fee for a pickup point', async () => {
    const m = await month('2026-11');
    expect(m.deliveryFeesSen).toBe(0);
    expect(m.verifiedSavingsSen).toBe(sumVerified(m.items));
  });

  it('shows the percentage saved against the usual price', async () => {
    const m = await month('2026-11');
    const usual = (await keptLines()).filter((l) => l.baselineKind === 'usual');
    const saved = usual.reduce((sum, l) => sum + l.savingSen, 0);
    const cost = usual.reduce((sum, l) => sum + l.baselineSen * l.units, 0);
    expect(usual).toHaveLength(5);
    expect(m.percentSaved).toBe(Math.round((saved / cost) * 1000) / 10);
  });

  it('adds up the fees paid on the goods that reached the hub in the month', async () => {
    const m = await month('2026-11');
    const fees = (await keptLines()).reduce((sum, l) => sum + l.allocated * l.finalFeeSen!, 0);
    expect(fees).toBeGreaterThan(0);
    expect(m.feesPaidSen).toBe(fees);
  });

  it('adds the approved claim refund to the month refunds, exactly (story 128)', async () => {
    const m = await month('2026-11');
    expect(m.refundsSen - monthBeforeCheck.refundsSen).toBe(15185);
  });

  it('counts the rounds joined and units bought in rounds that closed in the month', async () => {
    const m = await month('2026-11');
    expect(m.roundsJoined).toBe(6);
    // CM 6 + OIL 2 + EGG_A 10 + COFFEE 1 + CUPS 2 + EM 1; the damaged carton was still bought.
    expect(m.unitsBought).toBe(22);
  });

  it('shows estimated savings for closed lines that are not checked yet', async () => {
    // Before the check every allocated unit counts, so CM is 6 x 1315 rather than 5 x 1315.
    const after = sumVerified((await month('2026-11')).items);
    expect(monthBeforeCheck.verifiedSavingsSen).toBe(0);
    expect(monthBeforeCheck.estimatedSavingsSen).toBe(after + 1315);
    expect(monthBeforeCheck.items.every((i: any) => i.status === 'estimated')).toBe(true);
  });

  it('shows zero verified savings, not blanks, when nothing is checked yet', async () => {
    expect(await month('2026-12')).toMatchObject({
      month: '2026-12',
      roundsJoined: 0,
      unitsBought: 0,
      refundsSen: 0,
      feesPaidSen: 0,
      deliveryFeesSen: 0,
      verifiedSavingsSen: 0,
      estimatedSavingsSen: 0,
      percentSaved: null,
    });
  });

  it('refuses a month that is not YYYY-MM', async () => {
    expect((await ah.get(`/api/shops/${KEDAI}/savings?month=November`)).status).toBe(400);
  });

  it('keeps savings from staff (R6)', async () => {
    const res = await (await app.as('rahim')).get(`/api/shops/${KEDAI}/savings?month=2026-11`);
    expect(res.status).toBe(403);
  });

  it('keeps savings from another shop owner', async () => {
    const res = await (await app.as('siti')).get(`/api/shops/${KEDAI}/savings?month=2026-11`);
    expect(res.status).toBe(404);
  });

  it('sums the month and subtracts delivery fees for pickups checked that month (story 87)', async () => {
    const m = (await (await app.as('siti')).get(`/api/shops/${GERAI}/savings?month=2026-11`)).body;
    expect(m.deliveryFeesSen).toBe(1200); // the week-44 door pickup, checked Sun 1 Nov
    expect(m.verifiedSavingsSen).toBe(sumVerified(m.items) - 1200);
    expect(m.verifiedSavingsSen).toBe(4114); // RM 53.14 of verified savings less the RM 12.00 fee
  });
});

const monthItems = async () =>
  (await ah.get(`/api/shops/${KEDAI}/savings?month=2026-11`)).body as any;

describe('the home summary', () => {
  it('gathers this month, the balance and the approvals for the owner', async () => {
    const caller = personCaller(session('ahSeng', 'owner', { shopId: KEDAI }, 'shop'));
    const home = await homeSummary(app.deps, caller, KEDAI);
    expect(home.savingsThisMonth).toEqual({
      verifiedSen: sumVerified((await monthItems()).items),
      estimatedSen: 0,
    });
    expect(home.balanceSen).toBe(
      await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI }),
    );
    expect(home.pendingApprovals).toBe(0);
  });

  it('refuses staff, who see no money', async () => {
    const caller = personCaller(session('rahim', 'staff', { shopId: KEDAI }, 'shop'));
    await expect(homeSummary(app.deps, caller, KEDAI)).rejects.toMatchObject({ status: 403 });
  });
});

describe('the timeline of a Kongsi line', () => {
  const timeline = async (participationId: string) =>
    (await ah.get(`/api/activity?subjectType=participation&subjectId=${participationId}&related=1`))
      .body.items as any[];

  it('lists every step from joined to claim approved, as the owner sees them', async () => {
    const cm = lineOf(await historyItems(), 'condensed milk');
    const actions = (await timeline(cm.participationId)).map((i) => i.action).reverse();
    expect(actions).toEqual([
      'participation.joined',
      'refund.issued',
      // Partly ready when the first consignment arrived (P1-8), then ready.
      'fulfilment.pickup_ready',
      'fulfilment.pickup_ready',
      'fulfilment.pickup_collected',
      'check.delivery_check_submitted',
      'claim.submitted',
      'claim.approved',
    ]);
  });

  it('shows only the entries on the line itself without the related flag', async () => {
    const cm = lineOf(await historyItems(), 'condensed milk');
    const res = await ah.get(
      `/api/activity?subjectType=participation&subjectId=${cm.participationId}`,
    );
    expect(res.body.items.map((i: any) => i.action)).toEqual([
      'refund.issued',
      'participation.joined',
    ]);
  });

  const actionsOf = async (type: string, id: string, client = ah) =>
    (
      (await client.get(`/api/activity?subjectType=${type}&subjectId=${id}&related=1`)).body
        .items as any[]
    )
      .map((i) => i.action)
      .reverse();

  it('follows a pickup through its check and claim', async () => {
    const pickup = await pickupOf('KEDAI_KOPI', DATE);
    expect(await actionsOf('pickup', pickup.id)).toEqual([
      'fulfilment.pickup_ready',
      'fulfilment.pickup_ready',
      'fulfilment.pickup_collected',
      'check.delivery_check_submitted',
      'claim.submitted',
      'claim.approved',
    ]);
  });

  it('follows a claim back to its check and pickup', async () => {
    const claim = await app.prisma.claim.findFirstOrThrow({ where: { shopId: KEDAI } });
    expect(await actionsOf('claim', claim.id)).toEqual([
      'fulfilment.pickup_ready',
      'fulfilment.pickup_ready',
      'fulfilment.pickup_collected',
      'check.delivery_check_submitted',
      'claim.submitted',
      'claim.approved',
    ]);
  });

  it('follows a basket through its approval and line changes', async () => {
    const basketId = (await basketIdOf('KEDAI_KOPI', WEEK))!;
    const actions = await actionsOf('weekly_basket', basketId);
    expect(actions).toContain('basket.approved');
    expect(actions).toContain('basket.drafted');
  });

  it('shows another shop nothing from this shop timeline', async () => {
    const cm = lineOf(await historyItems(), 'condensed milk');
    const gerai = await app.as('siti');
    expect(await actionsOf('participation', cm.participationId, gerai)).toEqual([]);
    const claim = await app.prisma.claim.findFirstOrThrow({ where: { shopId: KEDAI } });
    expect(await actionsOf('claim', claim.id, gerai)).toEqual([]);
  });

  describe('the log check for owners', () => {
    it('tells an owner only whether the log is intact', async () => {
      const before = await app.prisma.activityLogEntry.count();
      const res = await ah.get('/api/activity/verify');
      expect(res.body).toEqual({ valid: true });
      expect(await app.prisma.activityLogEntry.count()).toBe(before);
    });

    it('gives Ops the entry count too', async () => {
      const res = await (await app.as('nadia')).get('/api/activity/verify');
      expect(res.body).toMatchObject({ valid: true, count: expect.any(Number) });
    });

    it('refuses staff with a 403', async () => {
      const res = await (await app.as('rahim')).get('/api/activity/verify');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('refuses a supplier with a 403', async () => {
      expect((await (await app.as('farid')).get('/api/activity/verify')).status).toBe(403);
    });
  });
});
