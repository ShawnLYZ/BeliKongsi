import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { verifyLogChain } from '@/server/modules/activity/log';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { runDueJobs } from '@/server/modules/jobs/run';
import { requestDeletion } from '@/server/modules/directory/deletion';
import { notify, TEMPLATES } from '@/server/modules/notifications/notify';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import {
  basketIdOf,
  consignmentFor,
  lastWhatsapp,
  moveConsignment,
  opsApprovalOf,
  payBasket,
  pickupOf,
  roundOf,
  setupKedaiKopi,
  supplierApprovalOf,
  supplierOrderOf,
  uploadPhoto,
} from './helpers/scenarios';

const KAFE = seedId('shop', 'KAFE');
const MEI = seedId('user', 'mei');
const DANIAL = seedId('user', 'danial');
const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const WEEK = '2026-W45';
const DATE = '2026-11-10';

let app: TestApp;
let mei: Client;
let nadia: Client;
let firstRequest: string;
let secondRequest: string;
let photoId: string;

const pendingRequest = () =>
  app.prisma.approvalRequest.findFirstOrThrow({
    where: { type: 'data_deletion', shopId: KAFE, status: 'pending' },
  });

/** Everything money-related, as JSON, to prove anonymising does not touch it. */
async function moneySnapshot() {
  const [payments, participations, postings, accounts] = await Promise.all([
    app.prisma.payment.findMany({ orderBy: { id: 'asc' } }),
    app.prisma.participation.findMany({ orderBy: { id: 'asc' } }),
    app.prisma.ledgerPosting.findMany({ orderBy: { id: 'asc' } }),
    app.prisma.ledgerAccount.findMany({ orderBy: { key: 'asc' } }),
  ]);
  return JSON.stringify({ payments, participations, postings, accounts }, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
}

beforeAll(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', WEEK))!);
  mei = await app.as('mei');
  nadia = await app.as('nadia');
  // The cut-off forms the rounds: Kafe now has rounds in progress and a balance.
  expect((await nadia.post('/api/demo/skip-to-cutoff')).status).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe('Asking for deletion (story 149)', () => {
  it('turns the request into an Ops approval with the evidence', async () => {
    const res = await mei.post(`/api/shops/${KAFE}/deletion-request`, { reason: 'Closing down' });
    expect(res.status).toBe(200);
    firstRequest = res.body.approvalId;
    expect(
      await app.prisma.approvalRequest.findUniqueOrThrow({ where: { id: firstRequest } }),
    ).toMatchObject({
      type: 'data_deletion',
      subjectType: 'shop',
      subjectId: KAFE,
      shopId: KAFE,
      assigneeRole: 'ops',
      status: 'pending',
      evidence: {
        activeRounds: expect.any(Number),
        openPickups: expect.any(Number),
        openClaims: 0,
        pendingPayments: 0,
        balanceSen: expect.any(Number),
        canApprove: false,
      },
    });
    const evidence = (await pendingRequest()).evidence as Record<string, number>;
    expect(evidence.activeRounds).toBeGreaterThan(0);
    expect(evidence.balanceSen).toBe(
      await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KAFE }),
    );
    expect(
      await app.prisma.activityLogEntry.findFirst({ where: { action: 'data.deletion_requested' } }),
    ).toMatchObject({ shopId: KAFE, subjectType: 'shop', subjectId: KAFE });
  });

  it('refuses a second request while one is pending', async () => {
    const res = await mei.post(`/api/shops/${KAFE}/deletion-request`, {});
    expect(res).toMatchObject({ status: 409, body: { code: 'DELETION_ALREADY_REQUESTED' } });
    expect(await app.prisma.approvalRequest.count({ where: { type: 'data_deletion' } })).toBe(1);
  });

  it('gives another shop owner a 404 and the shop staff a 403', async () => {
    const siti = await app.as('siti');
    expect((await siti.post(`/api/shops/${KAFE}/deletion-request`, {})).status).toBe(404);
    const danial = await app.as('danial');
    expect((await danial.post(`/api/shops/${KAFE}/deletion-request`, {})).status).toBe(403);
  });

  it('is blocked while rounds are still running, and nothing changes', async () => {
    const before = await app.prisma.shop.findUniqueOrThrow({ where: { id: KAFE } });
    const res = await nadia.post(`/api/approvals/${firstRequest}/approve`, {});
    expect(res).toMatchObject({
      status: 422,
      body: {
        code: 'DELETION_BLOCKED',
        details: {
          activeRounds: expect.any(Number),
          openPickups: expect.any(Number),
          openClaims: expect.any(Number),
          pendingPayments: expect.any(Number),
          balanceSen: expect.any(Number),
        },
      },
    });
    expect(res.body.details.activeRounds).toBeGreaterThan(0);
    expect((await pendingRequest()).id).toBe(firstRequest);
    expect(await app.prisma.shop.findUniqueOrThrow({ where: { id: KAFE } })).toEqual(before);
  });

  it('needs a reason to reject, then tells the owner why', async () => {
    const none = await nadia.post(`/api/approvals/${firstRequest}/reject`, {});
    expect(none).toMatchObject({ status: 422, body: { code: 'REASON_REQUIRED' } });
    expect((await pendingRequest()).id).toBe(firstRequest);

    const res = await nadia.post(`/api/approvals/${firstRequest}/reject`, {
      reason: 'Your rounds are still running',
    });
    expect(res.status).toBe(200);
    expect(
      await app.prisma.approvalRequest.findUniqueOrThrow({ where: { id: firstRequest } }),
    ).toMatchObject({ status: 'rejected', reason: 'Your rounds are still running' });
    expect(
      await lastWhatsapp('mei', 'deletion.decided', 'Your rounds are still running'),
    ).toContain('not approved');
    expect(await app.prisma.shop.findUniqueOrThrow({ where: { id: KAFE } })).toMatchObject({
      anonymisedAt: null,
    });
  });
});

describe('Approving deletion once everything is settled', () => {
  beforeAll(async () => {
    // The rest of the week: CM ordered, confirmed, dispatched, hub-checked, everything delivered.
    const cmRound = (await roundOf('CM', WEEK)).id;
    const cmOrder = (await supplierOrderOf(cmRound)).id;
    expect(
      (await nadia.post(`/api/approvals/${await opsApprovalOf(cmOrder)}/approve`, {})).status,
    ).toBe(200);
    const farid = await app.as('farid');
    expect(
      (
        await farid.post(`/api/approvals/${await supplierApprovalOf(cmOrder)}/approve`, {
          expectedDispatchDate: '2026-11-07',
        })
      ).status,
    ).toBe(200);
    expect((await farid.post(`/api/supplier-orders/${cmOrder}/dispatched`)).status).toBe(200);
    expect(
      (
        await nadia.post(`/api/supplier-orders/${cmOrder}/hub-check`, {
          goodUnits: 105,
          damagedUnits: 0,
        })
      ).status,
    ).toBe(200);
    expect((await nadia.post('/api/demo/complete-other-rounds')).status).toBe(200);
    for (const hub of ['HUB_KV', 'HUB_JOHOR']) {
      const c = await consignmentFor({ hub, destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE });
      if (c.status === 'planned') await moveConsignment(app, c.id, 'dispatched');
      if (c.status !== 'arrived') await moveConsignment(app, c.id, 'arrived');
    }
    const moving = await app.prisma.consignment.findMany({
      where: { status: { in: ['planned', 'dispatched', 'out_for_delivery'] } },
    });
    for (const c of moving) {
      const steps =
        c.destinationType === 'door'
          ? ['dispatched', 'out_for_delivery', 'delivered']
          : ['dispatched', 'arrived'];
      for (const step of steps.slice(steps.indexOf(c.status) + 1)) {
        await moveConsignment(app, c.id, step);
      }
    }
    // Rahim, Kumar and Danial collect and confirm "All received"; Danial attaches a photo.
    for (const [shopKey, userKey] of [
      ['KEDAI_KOPI', 'rahim'],
      ['GERAI', 'kumar'],
      ['KAFE', 'danial'],
    ] as const) {
      const p = await pickupOf(shopKey, DATE);
      const client = await app.as(userKey);
      if (p.status === 'ready' || p.status === 'out_for_delivery') {
        expect((await client.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(
          200,
        );
      }
      if (shopKey === 'KAFE') photoId = await uploadPhoto(client, p.id);
      const check = await client.post(`/api/pickups/${p.id}/delivery-check`, {
        allReceived: true,
      });
      expect(check.status).toBe(200);
    }
    expect(await app.prisma.pickup.findMany({ where: { status: { not: 'closed' } } })).toEqual([]);
  });

  it('is blocked while the balance is not zero, and deletes no files', async () => {
    const res = await mei.post(`/api/shops/${KAFE}/deletion-request`, {});
    expect(res.status).toBe(200);
    secondRequest = res.body.approvalId;
    const kafeBalance = await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KAFE });
    expect(kafeBalance).toBeGreaterThan(0);
    expect((await pendingRequest()).evidence).toMatchObject({
      activeRounds: 0,
      openPickups: 0,
      openClaims: 0,
      pendingPayments: 0,
      balanceSen: kafeBalance,
      canApprove: false,
    });

    const blocked = await nadia.post(`/api/approvals/${secondRequest}/approve`, {});
    expect(blocked).toMatchObject({
      status: 422,
      body: { code: 'DELETION_BLOCKED', details: { balanceSen: kafeBalance, activeRounds: 0 } },
    });
    expect((await pendingRequest()).id).toBe(secondRequest);
    expect(
      (await app.prisma.shop.findUniqueOrThrow({ where: { id: KAFE } })).anonymisedAt,
    ).toBeNull();
    const photo = await app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    expect(photo.deletedAt).toBeNull();
    expect(await app.deps.storage.statObject('delivery-photos', photo.storageKey)).not.toBeNull();
  });

  it('shows Ops the blockers as they are now, after the balance is withdrawn', async () => {
    const stored = (await pendingRequest()).evidence as Record<string, unknown>;
    const balance = await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KAFE });
    expect(stored).toMatchObject({ balanceSen: balance, canApprove: false });
    expect(
      (
        await mei.post(
          `/api/shops/${KAFE}/balance/withdraw`,
          { amountSen: balance },
          { 'idempotency-key': 'deletion-withdraw' },
        )
      ).status,
    ).toBe(200);
    const { items } = (await nadia.get('/api/approvals')).body;
    expect(items.find((i: { id: string }) => i.id === secondRequest).evidence).toEqual({
      activeRounds: 0,
      openPickups: 0,
      openClaims: 0,
      pendingPayments: 0,
      balanceSen: 0,
      canApprove: true,
      atRequest: stored,
    });
    // The stored evidence stays the snapshot taken when the owner asked.
    expect((await pendingRequest()).evidence).toEqual(stored);
  });

  it('is blocked by a pending payment alone, and nothing is anonymised', async () => {
    // Kafe has withdrawn its whole balance; the request is re-checked at approval.
    const payment = await app.prisma.payment.create({
      data: {
        shopId: KAFE,
        purpose: 'basket',
        linesTotalSen: 1000,
        deliveryFeeSen: 0,
        totalSen: 1000,
        balanceAppliedSen: 0,
        externalSen: 1000,
        status: 'pending',
        deadlineAt: new Date('2026-12-01T00:00:00Z'),
      },
    });
    const { items } = (await nadia.get('/api/approvals')).body;
    expect(items.find((i: { id: string }) => i.id === secondRequest).evidence).toMatchObject({
      pendingPayments: 1,
      canApprove: false,
    });
    const res = await nadia.post(`/api/approvals/${secondRequest}/approve`, {});
    expect(res).toMatchObject({
      status: 422,
      body: {
        code: 'DELETION_BLOCKED',
        details: { pendingPayments: 1, activeRounds: 0, openPickups: 0, balanceSen: 0 },
      },
    });
    expect((await pendingRequest()).id).toBe(secondRequest);
    expect(
      (await app.prisma.shop.findUniqueOrThrow({ where: { id: KAFE } })).anonymisedAt,
    ).toBeNull();
    expect(await app.prisma.membership.count({ where: { shopId: KAFE, endedAt: null } })).toBe(2);
    await app.prisma.payment.update({ where: { id: payment.id }, data: { status: 'voided' } });
  });

  it('anonymises the shop and keeps money records and the log intact', async () => {
    expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KAFE })).toBe(0);
    const photo = await app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    const logCount = await app.prisma.activityLogEntry.count();
    const money = await moneySnapshot();
    const participations = await app.prisma.participation.count({ where: { shopId: KAFE } });
    const gerai = await app.prisma.shop.findUniqueOrThrow({
      where: { id: seedId('shop', 'GERAI') },
    });

    // A decided claim approval of this shop, as the delivery check writes it.
    const claimApproval = await app.prisma.approvalRequest.create({
      data: {
        type: 'claim',
        subjectType: 'claim',
        subjectId: seedId('claim', 'fixture'),
        shopId: KAFE,
        assigneeRole: 'ops',
        summary: 'Claim for RM 10.00 from Kafe Contoh',
        whyNeeded: 'Missing goods.',
        evidence: { shopName: 'Kafe Contoh', note: 'Mei and Danial reported it', lines: [] },
        proposedByType: 'person',
        status: 'approved',
      },
    });
    // Ops claim notices name the shop in their text and are kept for Ops (no shop on the row).
    await withTransaction(app.deps, systemCaller('test'), async (ctx) => {
      const shops: [string, string][] = [
        ['kafe', 'Kafe Contoh'],
        ['gerai', gerai.name],
      ];
      for (const [key, shopName] of shops) {
        await notify(ctx, {
          type: 'ops.claim_needed',
          audience: { operator: true, roles: ['ops'] },
          link: '/approvals',
          message: TEMPLATES['ops.claim_needed']({ shopName, totalSen: 1000 }),
          dedupeKey: `ops.claim_needed:test-${key}`,
        });
      }
    });
    // The first file deletion fails; the due-jobs sweep must remove the file later.
    const realDelete = app.deps.storage.deleteObject;
    let failed = false;
    app.deps.storage.deleteObject = async (bucket, key) => {
      if (!failed) {
        failed = true;
        throw new Error('storage unavailable');
      }
      return realDelete(bucket, key);
    };
    let res;
    try {
      res = await nadia.post(`/api/approvals/${secondRequest}/approve`, {});
    } finally {
      app.deps.storage.deleteObject = realDelete;
    }
    expect(res.status).toBe(200);
    expect(failed).toBe(true);
    expect(await app.deps.storage.statObject('delivery-photos', photo.storageKey)).not.toBeNull();
    expect(
      (await app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } })).storagePurgedAt,
    ).toBeNull();
    await runDueJobs(app.deps);
    expect(await app.deps.storage.statObject('delivery-photos', photo.storageKey)).toBeNull();
    expect(
      (await app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } })).storagePurgedAt,
    ).toBeInstanceOf(Date);

    const scrubbed = await app.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: claimApproval.id },
    });
    expect(JSON.stringify(scrubbed)).not.toMatch(/Kafe Contoh|Mei|Danial/);
    expect(scrubbed.evidence).toMatchObject({ shopName: `Deleted shop ${KAFE.slice(0, 8)}` });
    expect(scrubbed.summary).toBe(`Claim for RM 10.00 from Deleted shop ${KAFE.slice(0, 8)}`);

    const shop = await app.prisma.shop.findUniqueOrThrow({ where: { id: KAFE } });
    expect(shop).toMatchObject({
      name: `Deleted shop ${KAFE.slice(0, 8)}`,
      address: '',
      state: '',
      postcode: '',
      lat: 0,
      lng: 0,
    });
    expect(shop.anonymisedAt).toBeInstanceOf(Date);
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: MEI } })).toMatchObject({
      displayName: 'Deleted user',
      email: null,
      phone: null,
      signInProvider: null,
    });
    expect(await app.prisma.user.findUniqueOrThrow({ where: { id: DANIAL } })).toMatchObject({
      displayName: 'Deleted user',
    });
    expect(await app.prisma.membership.count({ where: { shopId: KAFE, endedAt: null } })).toBe(0);
    expect(await app.prisma.usualList.count({ where: { shopId: KAFE } })).toBe(0);
    expect(await app.prisma.notification.count({ where: { userId: { in: [MEI, DANIAL] } } })).toBe(
      0,
    );
    // Other shops are untouched.
    expect(await app.prisma.shop.findUniqueOrThrow({ where: { id: gerai.id } })).toEqual(gerai);

    // The Ops claim notice no longer names the shop; another shop's notice keeps its name.
    const notices = (key: string) =>
      app.prisma.notification.findMany({
        where: { dedupeKey: { startsWith: `ops.claim_needed:test-${key}:` } },
      });
    const kafeNotices = await notices('kafe');
    expect(kafeNotices.length).toBeGreaterThan(0);
    for (const n of kafeNotices) {
      expect(JSON.stringify(n)).not.toMatch(/Kafe Contoh/);
      expect([n.body, n.whatsappText]).toEqual([
        `Claim awaiting decision: Deleted shop ${KAFE.slice(0, 8)}, RM 10.00.`,
        `Claim awaiting decision: Deleted shop ${KAFE.slice(0, 8)}, RM 10.00.`,
      ]);
    }
    const geraiNotices = await notices('gerai');
    expect(geraiNotices.length).toBeGreaterThan(0);
    for (const n of geraiNotices) {
      expect(n.whatsappText).toBe(`Claim awaiting decision: ${gerai.name}, RM 10.00.`);
    }

    // Photos: marked deleted, and the stored file is gone.
    expect(
      (await app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } })).deletedAt,
    ).toBeInstanceOf(Date);
    expect(await app.deps.storage.statObject('delivery-photos', photo.storageKey)).toBeNull();

    // Money records and the log stay; exactly one entry is appended, with ids only.
    expect(await moneySnapshot()).toBe(money);
    expect(await app.prisma.participation.count({ where: { shopId: KAFE } })).toBe(participations);
    expect(await app.prisma.activityLogEntry.count()).toBe(logCount + 1);
    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'shop.anonymised' },
    });
    expect(entry).toMatchObject({ shopId: KAFE, subjectType: 'shop', subjectId: KAFE });
    expect(JSON.stringify([entry.before, entry.after])).not.toMatch(/Kafe|Mei|Danial|contoh/i);
    expect((await verifyLogChain(app.prisma)).valid).toBe(true);
    expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
    expect(
      await app.prisma.approvalRequest.findUniqueOrThrow({ where: { id: secondRequest } }),
    ).toMatchObject({ status: 'approved' });
  });

  it('refuses a request for a shop that is already anonymised', async () => {
    await expect(requestDeletion(app.deps, systemCaller('test'), KAFE, {})).rejects.toMatchObject({
      status: 409,
      code: 'SHOP_ANONYMISED',
    });
  });
});
