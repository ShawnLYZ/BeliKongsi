import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { formatPickupCode } from '@/lib/format';
import { codeRandom, newPickupCode } from '@/server/modules/fulfilment/codes';
import { refreshPickupReadiness } from '@/server/modules/fulfilment/readiness';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import {
  allocationOf,
  consignmentFor,
  countWhatsapp,
  feeChargeOf,
  lastWhatsapp,
  moveConsignment,
  opsApprovalOf,
  participationOf,
  pickupOf,
  roundOf,
  supplierOrderOf,
  toHubChecked,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const DATE = '2026-11-10';

let app: TestApp;

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('Planning at the hub check', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
  });

  it('groups condensed milk into a planned consignment to the Ipoh pickup point', async () => {
    const c = await consignmentFor({
      hub: 'HUB_KV',
      destinationKey: `pp:${PP_IPOH}`,
      deliveryDate: DATE,
    });
    expect(c).toMatchObject({
      status: 'planned',
      wave: 1,
      destinationType: 'pickup_point',
      pickupPointId: PP_IPOH,
      shopId: null,
    });
    expect(c.partnerReference).toMatch(/^SIM-[0-9A-F]{8}$/);
    expect(c.statusHistory).toEqual([expect.objectContaining({ status: 'planned' })]);
    expect(await allocationOf('KEDAI_KOPI', 'CM')).toMatchObject({
      allocated: 6,
      consignmentId: c.id,
    });
  });

  it('gives each shop one pickup per place and date with a 6-digit code (stories 69, 73)', async () => {
    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.code).toMatch(/^\d{6}$/);
    expect(p).toMatchObject({
      status: 'waiting',
      destinationType: 'pickup_point',
      destinationKey: `pp:${PP_IPOH}`,
    });
    expect(await allocationOf('KEDAI_KOPI', 'CM')).toMatchObject({ pickupId: p.id });

    // A second round for the same place and date joins the same pickup and consignment.
    await toHubChecked(app, ['OIL']);
    const oil = await allocationOf('KEDAI_KOPI', 'OIL');
    expect(oil.pickupId).toBe(p.id);
    expect(await app.prisma.pickup.count({ where: { shopId: KEDAI } })).toBe(1);
  });

  it('plans a door consignment for a door shop', async () => {
    const doorPart = await app.prisma.participation.findFirstOrThrow({
      where: { round: { id: (await roundOf('CM', '2026-W45')).id }, destinationType: 'door' },
    });
    const c = await app.prisma.consignment.findFirstOrThrow({
      where: { destinationKey: `door:${doorPart.shopId}`, deliveryDate: DATE },
    });
    expect(c).toMatchObject({
      destinationType: 'door',
      shopId: doorPart.shopId,
      status: 'planned',
    });
    const pickup = await app.prisma.pickup.findFirstOrThrow({
      where: {
        shopId: doorPart.shopId,
        destinationKey: `door:${doorPart.shopId}`,
        deliveryDate: DATE,
      },
    });
    expect(pickup).toMatchObject({
      destinationType: 'door',
      pickupPointId: null,
      status: 'waiting',
    });
  });

  it('retries a pickup code that collides at the same destination', async () => {
    const taken = (await pickupOf('KEDAI_KOPI', DATE)).code;
    const other = taken === '012345' ? 543210 : 12345;
    const draw = vi
      .spyOn(codeRandom, 'randomInt')
      .mockReturnValueOnce(Number(taken))
      .mockReturnValueOnce(other);
    const code = await withTransaction(app.deps, systemCaller('test'), (ctx) =>
      newPickupCode(ctx, `pp:${PP_IPOH}`),
    );
    expect(draw).toHaveBeenCalledTimes(2);
    expect(code).toBe(String(other).padStart(6, '0'));
  });

  it('logs consignment creation by the system', async () => {
    const c = await consignmentFor({
      hub: 'HUB_KV',
      destinationKey: `pp:${PP_IPOH}`,
      deliveryDate: DATE,
    });
    const e = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'fulfilment.consignment_created', subjectId: c.id },
    });
    expect(e).toMatchObject({ actorType: 'system', actorUserId: null, subjectType: 'consignment' });
  });
});

describe('Pickup readiness (C4)', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
  });

  const arriveAll = () =>
    app.prisma.consignment.updateMany({ where: {}, data: { status: 'arrived' } });
  const refresh = (ids: string[]) =>
    withTransaction(app.deps, systemCaller('test'), (ctx) => refreshPickupReadiness(ctx, ids));

  it('keeps a pickup waiting while other rounds for that date are still kept', async () => {
    await arriveAll();
    const p = await pickupOf('KEDAI_KOPI', DATE);
    await refresh([p.id]);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
  });

  it('keeps a pickup waiting while a consignment carrying its goods has not arrived', async () => {
    await app.prisma.participation.updateMany({
      where: { shopId: KEDAI, status: 'kept' },
      data: { status: 'allocated' },
    });
    const p = await pickupOf('KEDAI_KOPI', DATE);
    await refresh([p.id]);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
  });

  it('makes the pickup ready and tells owner and staff once both gates hold (story 70)', async () => {
    await app.prisma.participation.updateMany({
      where: { shopId: KEDAI, status: 'kept' },
      data: { status: 'allocated' },
    });
    await arriveAll();
    const p = await pickupOf('KEDAI_KOPI', DATE);
    await refresh([p.id]);
    const ready = await pickupOf('KEDAI_KOPI', DATE);
    expect(ready.status).toBe('ready');
    expect(ready.readyAt).not.toBeNull();
    const text = `Ready at Ipoh pickup point (10 am–7 pm daily). Pickup code ${formatPickupCode(p.code)}.`;
    expect(await lastWhatsapp('ahSeng', 'pickup.ready')).toBe(text);
    expect(await lastWhatsapp('rahim', 'pickup.ready')).toBe(text);
    const e = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'fulfilment.pickup_ready', subjectId: p.id },
    });
    expect(e.shopId).toBe(KEDAI);
    const event = await app.prisma.integrationEvent.findFirst({ where: { type: 'pickup.ready' } });
    expect(event).not.toBeNull();

    // A second refresh changes nothing and sends nothing more.
    await refresh([p.id]);
    expect(await countWhatsapp('ahSeng', 'pickup.ready')).toBe(1);
  });

  it('readies a pickup when the last round holding it back is shorted at its hub check', async () => {
    const oil = await participationOf('KEDAI_KOPI', 'OIL');
    await app.prisma.participation.updateMany({
      where: { shopId: KEDAI, status: 'kept', id: { not: oil.id } },
      data: { status: 'allocated' },
    });
    await arriveAll();
    await toHubChecked(app, ['OIL'], { goodUnits: 0 });
    expect((await participationOf('KEDAI_KOPI', 'OIL')).status).toBe('shorted');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
  });

  it('sends a door pickup out for delivery once its consignment is out', async () => {
    const doorPart = await app.prisma.participation.findFirstOrThrow({
      where: { round: { id: (await roundOf('CM', '2026-W45')).id }, destinationType: 'door' },
    });
    await app.prisma.participation.updateMany({
      where: { shopId: doorPart.shopId, status: 'kept' },
      data: { status: 'allocated' },
    });
    const key = `door:${doorPart.shopId}`;
    const pickup = await app.prisma.pickup.findFirstOrThrow({
      where: { shopId: doorPart.shopId, destinationKey: key, deliveryDate: DATE },
    });
    await app.prisma.consignment.updateMany({
      where: { destinationKey: key, deliveryDate: DATE },
      data: { status: 'arrived' },
    });
    await refresh([pickup.id]);
    expect((await app.prisma.pickup.findUniqueOrThrow({ where: { id: pickup.id } })).status).toBe(
      'waiting',
    );
    await app.prisma.consignment.updateMany({
      where: { destinationKey: key, deliveryDate: DATE },
      data: { status: 'out_for_delivery' },
    });
    await refresh([pickup.id]);
    expect((await app.prisma.pickup.findUniqueOrThrow({ where: { id: pickup.id } })).status).toBe(
      'out_for_delivery',
    );
  });
});

describe('Through the partner status moves', () => {
  const KV_IPOH = { hub: 'HUB_KV', destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE };

  it('keeps a pickup waiting while other rounds for that date have not reached the hub (C4)', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
    const c = await consignmentFor(KV_IPOH);
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
    // OIL, EGG_A, COFFEE and CUPS are still kept.
    expect((await participationOf('KEDAI_KOPI', 'OIL')).status).toBe('kept');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
  });

  it('starts a new consignment wave once the first has left (C3)', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['OIL']);
    const wave1 = await consignmentFor(KV_IPOH);
    expect(wave1).toMatchObject({ wave: 1, status: 'planned' });
    await moveConsignment(app, wave1.id, 'dispatched');
    await toHubChecked(app, ['CM']);
    const wave2 = await consignmentFor(KV_IPOH);
    expect(wave2).toMatchObject({ wave: 2, status: 'planned' });
    expect(wave2.id).not.toBe(wave1.id);
    expect(await allocationOf('KEDAI_KOPI', 'CM')).toMatchObject({ consignmentId: wave2.id });
  });

  it('readies a pickup when the last round holding it back is cancelled (C4)', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
    const cups = await participationOf('KEDAI_KOPI', 'CUPS');
    // Every other round of Kedai Kopi's for the date has reached the hub; cups have not.
    await app.prisma.participation.updateMany({
      where: { shopId: KEDAI, status: 'kept', id: { not: cups.id } },
      data: { status: 'allocated' },
    });
    const c = await consignmentFor(KV_IPOH);
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');

    const cupsOrder = await supplierOrderOf(cups.roundId);
    const rejected = await (
      await app.as('nadia')
    ).post(`/api/approvals/${await opsApprovalOf(cupsOrder.id)}/reject`, {
      reason: 'Supplier price dispute',
    });
    expect(rejected.status).toBe(200);
    expect((await participationOf('KEDAI_KOPI', 'CUPS')).status).toBe('refunded_round_cancelled');
    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('ready');
    expect(await lastWhatsapp('ahSeng', 'pickup.ready')).toBe(
      `Ready at Ipoh pickup point (10 am–7 pm daily). Pickup code ${formatPickupCode(p.code)}.`,
    );
  });
});

describe('Shorted lines', () => {
  it('get no consignment or pickup', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM'], { goodUnits: 0 });
    const a = await allocationOf('KEDAI_KOPI', 'CM');
    expect(a).toMatchObject({ allocated: 0, consignmentId: null, pickupId: null });
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('shorted');
    // None for the demo week's date: the history week's were planned a week earlier.
    expect(await app.prisma.consignment.count({ where: { deliveryDate: DATE } })).toBe(0);
    expect(await app.prisma.pickup.count({ where: { deliveryDate: DATE } })).toBe(0);
  });

  it("gives Gerai Contoh's delivery fee back when its only door line for the date is shorted", async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['OIL']); // reaches the cut-off; Gerai Contoh has no oil
    const cm = await participationOf('GERAI', 'CM');
    // Leave condensed milk as Gerai Contoh's only door line still heading for delivery.
    await app.prisma.participation.updateMany({
      where: { shopId: cm.shopId, status: 'kept', id: { not: cm.id } },
      data: { status: 'refunded_round_cancelled' },
    });
    expect(await feeChargeOf('GERAI', cm.deliveryDate)).toMatchObject({ status: 'held' });
    await toHubChecked(app, ['CM'], { goodUnits: 0 });
    expect(await feeChargeOf('GERAI', cm.deliveryDate)).toMatchObject({ status: 'refunded' });
  });
});
