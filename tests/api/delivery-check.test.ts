import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { runBackgroundAutomation } from '@/server/modules/fulfilment/background';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import { expectNoMoneyFields } from './helpers/scans';
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
let cmAlloc: string;

/** Kedai Kopi's pickup at Ipoh, collected by Rahim. */
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
  cmAlloc = (await allocationOf('KEDAI_KOPI', 'CM')).id;
});

afterEach(async () => {
  await app.close();
});

const claim = (id: string) => app.prisma.claim.findUniqueOrThrow({ where: { id } });
async function check(body: unknown) {
  const rahim = await app.as('rahim');
  return rahim.post(`/api/pickups/${p.id}/delivery-check`, body);
}

describe('Delivery check', () => {
  it('closes the pickup when everything arrived (story 78)', async () => {
    const res = await check({ allReceived: true });
    expect(res).toMatchObject({ status: 200, body: { result: 'all_received', claimId: null } });
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
    expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({ status: 'closed' });
    expect(await app.prisma.claim.count()).toBe(0);
  });

  it('records every line as fully received when all arrived', async () => {
    const { body } = await check({ allReceived: true });
    const lines = await app.prisma.deliveryCheckLine.findMany({
      where: { deliveryCheckId: body.checkId },
    });
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).toMatchObject({ missing: 0, damaged: 0 });
      expect(l.receivedGood).toBe(l.expected);
    }
  });

  it('opens a claim for 1 damaged carton worth RM 151.85 (stories 79-81)', async () => {
    const rahim = await app.as('rahim');
    const photo = await uploadPhoto(rahim, p.id);
    const r = (
      await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
        lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] }],
      })
    ).body;
    expect(r.result).toBe('issues');
    expect(await claim(r.claimId)).toMatchObject({ status: 'submitted', totalRefundSen: 15185 });
    expect(await lastWhatsapp('ahSeng', 'claim.submitted')).toBe(
      'Rahim reported a problem: 1 carton of condensed milk (damaged). Claim for RM 151.85 sent to BeliKongsi.',
    );
    expect(await lastWhatsapp('rahim', 'claim.submitted')).toBe(
      'Problem reported: 1 carton of condensed milk. BeliKongsi will check it.',
    );
    expect(await lastWhatsapp('nadia', 'ops.claim_needed')).toBe(
      'Claim awaiting decision: Kedai Kopi Contoh, RM 151.85.',
    );
  });

  it('files the claim for Ops with evidence and attaches the photo', async () => {
    const rahim = await app.as('rahim');
    const photo = await uploadPhoto(rahim, p.id);
    const { claimId, checkId } = (
      await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
        lines: [{ allocationId: cmAlloc, missing: 1, damaged: 1, photoIds: [photo] }],
      })
    ).body;
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('checked');
    expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({ status: 'received' });
    const c = await claim(claimId);
    expect(c.totalRefundSen).toBe(30370);
    const approval = await app.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: c.approvalRequestId! },
    });
    expect(approval).toMatchObject({
      type: 'claim',
      assigneeRole: 'ops',
      amountSen: 30370,
      status: 'pending',
      subjectId: claimId,
    });
    expect(approval.evidence).toMatchObject({
      shopName: 'Kedai Kopi Contoh',
      lines: [expect.objectContaining({ missing: 1, damaged: 1, photoCount: 1 })],
      hubChecks: expect.any(Array),
      consignments: expect.any(Array),
    });
    const line = await app.prisma.deliveryCheckLine.findFirstOrThrow({
      where: { deliveryCheckId: checkId, allocationId: cmAlloc },
    });
    expect(line.receivedGood).toBe(line.expected - 2);
    const stored = await app.prisma.photo.findUniqueOrThrow({ where: { id: photo } });
    expect(stored.deliveryCheckLineId).toBe(line.id);
    const logs = await app.prisma.activityLogEntry.findMany({
      where: {
        action: { in: ['check.delivery_check_submitted', 'claim.submitted'] },
        subjectId: { in: [checkId, claimId] },
      },
    });
    expect(logs.map((l) => l.action).sort()).toEqual([
      'check.delivery_check_submitted',
      'claim.submitted',
    ]);
    expect(JSON.stringify(logs.map((l) => [l.before, l.after]))).not.toMatch(/Kedai|Rahim|Seng/);
  });

  it('describes several problem lines in one notice', async () => {
    const eggAlloc = (await allocationOf('KEDAI_KOPI', 'EGG_A')).id;
    const rahim = await app.as('rahim');
    const photo = await uploadPhoto(rahim, p.id);
    const res = await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
      lines: [
        { allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] },
        { allocationId: eggAlloc, missing: 1, damaged: 0, photoIds: [] },
      ],
    });
    expect(res.status).toBe(200);
    const text = (await lastWhatsapp('ahSeng', 'claim.submitted'))!;
    expect(text).toContain('1 carton of condensed milk (damaged), ');
    expect(text).toMatch(/\(missing\)\. Claim for RM /);
  });

  it('refuses a second check and keeps one claim', async () => {
    const rahim = await app.as('rahim');
    const photo = await uploadPhoto(rahim, p.id);
    const body = { lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] }] };
    expect((await rahim.post(`/api/pickups/${p.id}/delivery-check`, body)).status).toBe(200);
    const again = await rahim.post(`/api/pickups/${p.id}/delivery-check`, body);
    expect(again).toMatchObject({ status: 409, body: { code: 'CHECK_EXISTS' } });
    expect(await app.prisma.claim.count()).toBe(1);
    expect(await app.prisma.deliveryCheck.count({ where: { pickupId: p.id } })).toBe(1);
  });

  it('gives one check and one claim when submitted twice at once', async () => {
    const rahim = await app.as('rahim');
    const photo = await uploadPhoto(rahim, p.id);
    const body = { lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] }] };
    const [a, b] = await Promise.all([
      rahim.post(`/api/pickups/${p.id}/delivery-check`, body),
      rahim.post(`/api/pickups/${p.id}/delivery-check`, body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await app.prisma.claim.count()).toBe(1);
    expect(await app.prisma.deliveryCheck.count({ where: { pickupId: p.id } })).toBe(1);
  });

  it('refuses more missing plus damaged than allocated, naming the line', async () => {
    const r = await check({
      lines: [{ allocationId: cmAlloc, missing: 4, damaged: 3, photoIds: [] }],
    });
    expect(r).toMatchObject({
      status: 422,
      body: { code: 'MORE_THAN_ALLOCATED', details: { allocationId: cmAlloc } },
    });
    expect(await app.prisma.deliveryCheck.count({ where: { pickupId: p.id } })).toBe(0);
  });

  it("refuses another pickup's photo", async () => {
    const elsewhere = await app.prisma.pickup.create({
      data: {
        shopId: KEDAI,
        destinationType: 'pickup_point',
        pickupPointId: p.pickupPointId,
        destinationKey: p.destinationKey,
        deliveryDate: '2026-11-17',
        code: '999999',
        status: 'collected',
      },
    });
    const rahim = await app.as('rahim');
    const photo = await uploadPhoto(rahim, elsewhere.id);
    const r = await check({
      lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] }],
    });
    expect(r).toMatchObject({ status: 422, body: { code: 'PHOTO_NOT_FOUND' } });
    expect(await app.prisma.claim.count()).toBe(0);
  });

  it('refuses a photo that was requested but never uploaded', async () => {
    const rahim = await app.as('rahim');
    const { photoId } = (
      await rahim.post(`/api/pickups/${p.id}/photos`, {
        contentType: 'image/jpeg',
        sizeBytes: 2048,
      })
    ).body;
    const r = await check({
      lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photoId] }],
    });
    expect(r).toMatchObject({ status: 422, body: { code: 'PHOTO_NOT_FOUND' } });
  });

  it('refuses a stored object that is not an image', async () => {
    const rahim = await app.as('rahim');
    const photoId = await uploadPhoto(rahim, p.id);
    const photo = await app.prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    await app.deps.storage.putObject(
      'delivery-photos',
      photo.storageKey,
      new Uint8Array(2048).fill(1),
      'application/pdf',
    );
    const r = await check({
      lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photoId] }],
    });
    expect(r).toMatchObject({ status: 422, body: { code: 'PHOTO_NOT_FOUND' } });
    expect(await app.prisma.claim.count()).toBe(0);
  });

  it('refuses more than 3 photos on one line', async () => {
    const rahim = await app.as('rahim');
    const photoIds: string[] = [];
    for (let i = 0; i < 4; i += 1) photoIds.push(await uploadPhoto(rahim, p.id));
    const r = await check({ lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds }] });
    expect(r).toMatchObject({ status: 422, body: { code: 'TOO_MANY_PHOTOS' } });
  });

  it('refuses a check before the goods are collected', async () => {
    await app.prisma.pickup.update({ where: { id: p.id }, data: { status: 'ready' } });
    expect(await check({ allReceived: true })).toMatchObject({
      status: 409,
      body: { code: 'NOT_COLLECTED' },
    });
  });

  it("hides another shop's pickup", async () => {
    const siti = await app.as('siti');
    const res = await siti.post(`/api/pickups/${p.id}/delivery-check`, { allReceived: true });
    expect(res.status).toBe(404);
  });

  it('checks background shops automatically, labelled as simulation', async () => {
    const shops = await app.prisma.shop.findMany({
      where: { isBackground: true },
      select: { id: true },
    });
    const bg = await app.prisma.pickup.findFirstOrThrow({
      where: {
        shopId: { in: shops.map((x) => x.id) },
        destinationType: 'pickup_point',
        deliveryDate: DATE,
      },
      orderBy: { id: 'asc' },
    });
    await app.prisma.pickup.update({ where: { id: bg.id }, data: { status: 'ready' } });
    await withTransaction(app.deps, systemCaller('test'), (ctx) =>
      runBackgroundAutomation(ctx, [bg.id]),
    );
    expect((await app.prisma.pickup.findUniqueOrThrow({ where: { id: bg.id } })).status).toBe(
      'closed',
    );
    const dc = await app.prisma.deliveryCheck.findUniqueOrThrow({ where: { pickupId: bg.id } });
    expect(dc).toMatchObject({ result: 'all_received', submittedByUserId: null });
    const log = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'check.delivery_check_submitted', subjectId: dc.id },
    });
    expect(log).toMatchObject({ actorType: 'system', reason: 'background shop simulation' });
  });

  it('completes a round once every pickup carrying it is closed', async () => {
    const part = await participationOf('KEDAI_KOPI', 'CM');
    const parts = await app.prisma.participation.findMany({
      where: { roundId: part.roundId },
      select: { id: true },
    });
    const carried = await app.prisma.allocation.findMany({
      where: { participationId: { in: parts.map((x) => x.id) }, pickupId: { not: null } },
    });
    const others = carried.map((a) => a.pickupId!).filter((id) => id !== p.id);
    await app.prisma.pickup.updateMany({
      where: { id: { in: others } },
      data: { status: 'closed' },
    });
    expect(
      (await app.prisma.round.findUniqueOrThrow({ where: { id: part.roundId } })).status,
    ).not.toBe('completed');
    await check({ allReceived: true });
    expect((await app.prisma.round.findUniqueOrThrow({ where: { id: part.roundId } })).status).toBe(
      'completed',
    );
  });

  it('keeps prices out of the staff check (story 77)', async () => {
    const res = await check({ allReceived: true });
    expectNoMoneyFields(res.body);
    const rahim = await app.as('rahim');
    expectNoMoneyFields((await rahim.get(`/api/shops/${KEDAI}/pickups?status=past`)).body);
  });
});
