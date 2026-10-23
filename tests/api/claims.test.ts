import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { collectPickup } from '@/server/modules/fulfilment/pickups';
import { systemCaller } from '@/server/platform/caller';
import { balanceOf } from '@/server/modules/ledger/accounts';
import { runMoneyChecks } from '@/server/modules/ledger/checks';
import { expectNoMoneyFields } from './helpers/scans';
import { createTestApp, type TestApp } from './helpers/app';
import {
  allocationOf,
  consignmentFor,
  lastWhatsapp,
  moveConsignment,
  participationOf,
  pickupOf,
  toHubChecked,
  uploadPhoto,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const DATE = '2026-11-10';
const KEDAI_ROUNDS = ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];

let app: TestApp;
let p: Awaited<ReturnType<typeof pickupOf>>;
let claimId: string;
let claimApproval: string;

/** Kedai Kopi collected its Ipoh pickup and Rahim reported 1 damaged carton of condensed milk. */
beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toHubChecked(app, KEDAI_ROUNDS);
  for (const hub of ['HUB_KV', 'HUB_JOHOR']) {
    const c = await consignmentFor({ hub, destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE });
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
  }
  p = await pickupOf('KEDAI_KOPI', DATE);
  const rahim = await app.as('rahim');
  expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
  const cmAlloc = (await allocationOf('KEDAI_KOPI', 'CM')).id;
  const photo = await uploadPhoto(rahim, p.id);
  const res = await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
    lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] }],
  });
  expect(res.status).toBe(200);
  claimId = res.body.claimId;
  claimApproval = (await app.prisma.claim.findUniqueOrThrow({ where: { id: claimId } }))
    .approvalRequestId!;
});

afterEach(async () => {
  await app.close();
});

const shopBalance = () => balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI });
const claim = () => app.prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
const moneyOk = async () => expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);

async function expectPickupClosed() {
  expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
  const allocs = await app.prisma.allocation.findMany({
    where: { pickupId: p.id, allocated: { gt: 0 } },
    select: { participationId: true },
  });
  const parts = await app.prisma.participation.findMany({
    where: { id: { in: allocs.map((a) => a.participationId) } },
    select: { status: true },
  });
  expect(parts.length).toBeGreaterThan(0);
  expect(parts.every((x) => x.status === 'closed')).toBe(true);
}

describe('Ops decides claims', () => {
  it('refunds RM 151.85 when Ops approves the claim (story 128)', async () => {
    const nadia = await app.as('nadia');
    const before = await shopBalance();
    const res = await nadia.post(`/api/approvals/${claimApproval}/approve`, {});
    expect(res.status).toBe(200);
    expect(await shopBalance()).toBe(before + 15185);
    expect(await lastWhatsapp('ahSeng', 'claim.decided')).toBe(
      'Claim approved: RM 151.85 refunded for 1 damaged carton.',
    );
    expect(await lastWhatsapp('rahim', 'claim.decided')).toBe(
      'Claim approved for 1 damaged carton.',
    );
    expect(await claim()).toMatchObject({ status: 'approved', reason: null });
    expect((await claim()).decidedAt).not.toBeNull();
    await expectPickupClosed();
    await moneyOk();
  });

  it('names the product in the owner money history after the claim is approved', async () => {
    await (await app.as('nadia')).post(`/api/approvals/${claimApproval}/approve`, {});
    const res = await (await app.as('ahSeng')).get(`/api/shops/${KEDAI}/balance`);
    expect(res.status).toBe(200);
    const item = res.body.history.items.find((i: { kind: string }) => i.kind === 'claim_refund');
    expect(item).toMatchObject({
      label: 'Claim refund: condensed milk',
      amountSen: 15185,
      balanceChangeSen: 15185,
    });
  });

  it('records the refund posting against the claim', async () => {
    const nadia = await app.as('nadia');
    await nadia.post(`/api/approvals/${claimApproval}/approve`, {});
    const postings = await app.prisma.ledgerPosting.findMany({ where: { claimId } });
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({ kind: 'refund_claim', amountSen: 15185 });
  });

  it('logs the decision and the refund without names', async () => {
    const nadia = await app.as('nadia');
    await nadia.post(`/api/approvals/${claimApproval}/approve`, {});
    const all = await app.prisma.activityLogEntry.findMany({
      where: { action: { in: ['claim.approved', 'refund.issued'] } },
    });
    const logs = all.filter(
      (l) =>
        l.subjectId === claimId || (l.after as { claimId?: string } | null)?.claimId === claimId,
    );
    expect(logs.map((l) => l.action).sort()).toEqual(['claim.approved', 'refund.issued']);
    expect(JSON.stringify(logs.map((l) => [l.before, l.after]))).not.toMatch(/Kedai|Rahim|Seng/);
    const events = await app.prisma.integrationEvent.findMany({
      where: { type: { in: ['claim.decided', 'refund.issued'] } },
    });
    const mine = events.filter((e) => JSON.stringify(e.data).includes(claimId));
    expect(mine.map((e) => e.type).sort()).toEqual(['claim.decided', 'refund.issued']);
  });

  it('completes the round when the approved claim was the last open pickup', async () => {
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const parts = await app.prisma.participation.findMany({
      where: { roundId: part.roundId },
      select: { id: true },
    });
    const carried = await app.prisma.allocation.findMany({
      where: { participationId: { in: parts.map((x) => x.id) }, pickupId: { not: null } },
    });
    await app.prisma.pickup.updateMany({
      where: { id: { in: carried.map((a) => a.pickupId!).filter((id) => id !== p.id) } },
      data: { status: 'closed' },
    });
    const nadia = await app.as('nadia');
    await nadia.post(`/api/approvals/${claimApproval}/approve`, {});
    expect((await app.prisma.round.findUniqueOrThrow({ where: { id: part.roundId } })).status).toBe(
      'completed',
    );
  });

  it('needs a reason to reject a claim', async () => {
    const nadia = await app.as('nadia');
    const before = await shopBalance();
    const res = await nadia.post(`/api/approvals/${claimApproval}/reject`, {});
    expect(res).toMatchObject({ status: 422, body: { code: 'REASON_REQUIRED' } });
    expect((await claim()).status).toBe('submitted');
    expect(await shopBalance()).toBe(before);
  });

  it('closes the pickup without a refund when Ops rejects with a reason', async () => {
    const nadia = await app.as('nadia');
    const before = await shopBalance();
    const res = await nadia.post(`/api/approvals/${claimApproval}/reject`, {
      reason: 'Photo shows an intact carton',
    });
    expect(res.status).toBe(200);
    expect(await claim()).toMatchObject({
      status: 'rejected',
      reason: 'Photo shows an intact carton',
    });
    await expectPickupClosed();
    expect(await shopBalance()).toBe(before);
    expect(await app.prisma.ledgerPosting.count({ where: { claimId } })).toBe(0);
    expect(await lastWhatsapp('ahSeng', 'claim.decided')).toBe(
      'Claim rejected: Photo shows an intact carton.',
    );
    expect(await lastWhatsapp('rahim', 'claim.decided')).toBe(
      'Claim rejected: Photo shows an intact carton.',
    );
    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'claim.rejected' },
    });
    expect(log.subjectId).toBe(claimId);
    await moneyOk();
  });

  it('refuses a second decision', async () => {
    const nadia = await app.as('nadia');
    await nadia.post(`/api/approvals/${claimApproval}/approve`, {});
    const again = await nadia.post(`/api/approvals/${claimApproval}/approve`, {});
    expect(again).toMatchObject({ status: 409, body: { code: 'ALREADY_DECIDED' } });
    expect(await app.prisma.ledgerPosting.count({ where: { claimId } })).toBe(1);
  });

  it('shows Ops the photos, the check, the hub record and the consignment history together (story 127)', async () => {
    // Every other shop on the same consignment collects too, so the consignment completes.
    const cm = await allocationOf('KEDAI_KOPI', 'CM');
    const carried = await app.prisma.allocation.findMany({
      where: { consignmentId: cm.consignmentId!, pickupId: { not: null, notIn: [p.id] } },
      select: { pickupId: true },
    });
    for (const id of new Set(carried.map((a) => a.pickupId!))) {
      const other = await app.prisma.pickup.findUniqueOrThrow({ where: { id } });
      await app.prisma.pickup.update({ where: { id }, data: { status: 'ready' } });
      await collectPickup(app.deps, systemCaller('test'), id, { code: other.code });
    }
    const nadia = await app.as('nadia');
    const c = (await nadia.get(`/api/claims/${claimId}`)).body;
    expect(c).toMatchObject({ claimId, status: 'submitted', totalRefundSen: 15185 });
    expect(c.lines[0].photoUrls).toHaveLength(1);
    expect(c.lines[0]).toMatchObject({ missing: 0, damaged: 1, refundSen: 15185 });
    expect(c.check.lines.filter((l: { damaged: number }) => l.damaged > 0)).toHaveLength(1);
    expect(c.check.lines.reduce((n: number, l: { damaged: number }) => n + l.damaged, 0)).toBe(1);
    expect(c.check.submittedBy).toBe('Rahim');
    expect(c.approvalId).toBe(claimApproval);
    expect(c.hubCheck.goodUnits).toBe(105);
    expect(c.consignmentHistory.map((h: { status: string }) => h.status)).toEqual([
      'planned',
      'dispatched',
      'arrived',
      'completed',
    ]);
  });

  it('shows the owner the claim and its photos', async () => {
    const ahSeng = await app.as('ahSeng');
    const res = await ahSeng.get(`/api/claims/${claimId}`);
    expect(res.status).toBe(200);
    expect(res.body.lines[0].photoUrls).toHaveLength(1);
    expect(res.body.approvalId).toBeNull();
  });

  it('keeps a claim from other shops, suppliers and the shop staff', async () => {
    for (const who of ['siti', 'farid', 'rahim'] as const) {
      const client = await app.as(who);
      expect((await client.get(`/api/claims/${claimId}`)).status).toBe(404);
    }
  });

  it('keeps the decision from the shop owner', async () => {
    const ahSeng = await app.as('ahSeng');
    const res = await ahSeng.post(`/api/approvals/${claimApproval}/approve`, {});
    expect(res.status).toBe(403);
    expect((await claim()).status).toBe('submitted');
  });

  it('points Ops at the claim screen from the approvals list and the notice', async () => {
    const nadia = await app.as('nadia');
    const list = await nadia.get('/api/approvals');
    expect(list.status).toBe(200);
    const item = list.body.items.find((a: { id: string }) => a.id === claimApproval);
    expect(item.link).toBe(`/ops/claims/${claimId}`);
    const note = await app.prisma.notification.findFirstOrThrow({
      where: { type: 'ops.claim_needed' },
    });
    expect(note.link).toBe(`/ops/claims/${claimId}`);
  });

  it('shows staff the pickup lines with the claim id, a picture and no money', async () => {
    const rahim = await app.as('rahim');
    const res = await rahim.get(`/api/shops/${KEDAI}/pickups`);
    expect(res.status).toBe(200);
    const pickup = res.body.items.find((i: { pickupId: string }) => i.pickupId === p.id);
    expect(pickup.claimId).toBe(claimId);
    expect(pickup.status).toBe('checked');
    expect(pickup.lines[0]).toEqual(
      expect.objectContaining({
        allocationId: expect.any(String),
        category: expect.any(String),
        imageAiGenerated: expect.any(Boolean),
      }),
    );
    expectNoMoneyFields(res.body);
  });
});
