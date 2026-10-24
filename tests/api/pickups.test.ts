import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { closeRoundById } from '@/server/modules/rounds/close';
import { createTestApp, type TestApp } from './helpers/app';
import { expectNoMoneyFields } from './helpers/scans';
import {
  basketIdOf,
  consignmentFor,
  countWhatsapp,
  lastWhatsapp,
  moveConsignment,
  payBasket,
  pickupOf,
  roundOf,
  setupKedaiKopi,
  toFormed,
  toHubChecked,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const DATE = '2026-11-10';
const KV_IPOH = { hub: 'HUB_KV', destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE };
const JOHOR_IPOH = { ...KV_IPOH, hub: 'HUB_JOHOR' };
const GERAI_DOOR = { hub: 'HUB_KV', destinationKey: `door:${GERAI}`, deliveryDate: DATE };

// Every round Kedai Kopi Contoh has a line in (its usual list).
const KEDAI_ROUNDS = ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];
// Every round Gerai Contoh has a line in.
const GERAI_ROUNDS = ['CM', 'EM', 'FLOUR', 'CONT'];

let app: TestApp;

afterEach(async () => {
  await app.close();
});

async function arriveAtIpoh(which = [KV_IPOH, JOHOR_IPOH]) {
  for (const where of which) {
    const c = await consignmentFor(where);
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
  }
}

describe('Collecting at the pickup point', () => {
  let p: Awaited<ReturnType<typeof pickupOf>>;

  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    await arriveAtIpoh();
    p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('ready');
  });

  it('refuses a wrong code and leaves the pickup ready', async () => {
    const rahim = await app.as('rahim');
    const res = await rahim.post(`/api/pickups/${p.id}/collect`, { code: '000000' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WRONG_CODE');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
  });

  it('marks the handover with the right code (story 76)', async () => {
    const rahim = await app.as('rahim');
    const res = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pickupId: p.id,
      status: 'collected',
      statusLabel: 'Collected',
    });
    expectNoMoneyFields(res.body);
    const after = await pickupOf('KEDAI_KOPI', DATE);
    expect(after.collectedAt).not.toBeNull();
    expect(after.collectedByUserId).toBe(seedId('user', 'rahim'));
    const e = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'fulfilment.pickup_collected', subjectId: p.id },
    });
    expect(e).toMatchObject({ actorType: 'person', shopId: KEDAI });
    const events = await app.prisma.integrationEvent.findMany({
      where: { type: 'pickup.collected' },
    });
    const event = events.find((ev) => (ev.data as { pickupId?: string }).pickupId === p.id);
    expect(event?.data).toMatchObject({
      pickupId: p.id,
      shopId: KEDAI,
      destinationType: 'pickup_point',
      deliveryDate: DATE,
    });
  });

  it('accepts the code written with a space, as it is shown', async () => {
    const rahim = await app.as('rahim');
    const shown = `${p.code.slice(0, 3)} ${p.code.slice(3)}`;
    const res = await rahim.post(`/api/pickups/${p.id}/collect`, { code: shown });
    expect(res.status).toBe(200);
  });

  it('refuses a second collect of the same pickup and logs it once', async () => {
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    const again = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('NOT_READY');
    const n = await app.prisma.activityLogEntry.count({
      where: { action: 'fulfilment.pickup_collected', subjectId: p.id },
    });
    expect(n).toBe(1);
  });

  it('completes a pickup-point consignment once all of its pickups are collected', async () => {
    const kv = await consignmentFor(KV_IPOH);
    // Every other shop's pickup carried by the consignment is already collected.
    const lines = await app.prisma.allocation.findMany({
      where: { consignmentId: kv.id, pickupId: { not: null } },
      select: { pickupId: true },
    });
    const others = [...new Set(lines.map((l) => l.pickupId!))].filter((id) => id !== p.id);
    expect(others.length).toBeGreaterThan(0);
    await app.prisma.pickup.updateMany({
      where: { id: { in: others } },
      data: { status: 'collected' },
    });
    expect((await consignmentFor(KV_IPOH)).status).toBe('arrived');

    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    const done = await consignmentFor(KV_IPOH);
    expect(done.status).toBe('completed');
    expect(done.statusHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'completed' })]),
    );
    const moves = await app.prisma.activityLogEntry.findMany({
      where: { action: 'fulfilment.consignment_status_changed', subjectId: kv.id },
    });
    expect(moves.map((m) => (m.after as { status: string }).status)).toContain('completed');
  });

  it('keeps the consignment arrived while another of its pickups is not collected', async () => {
    // Background shops took their arrived goods at once (P1-8, even with rounds still to be
    // hub-checked); Kedai Kopi's pickup is ready and not collected yet.
    const kv = await consignmentFor(KV_IPOH);
    const open = await app.prisma.allocation.count({
      where: { consignmentId: kv.id, pickupId: p.id, collectionId: null },
    });
    expect(open).toBeGreaterThan(0);
    expect(kv.status).toBe('arrived');
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    expect((await consignmentFor(KV_IPOH)).status).toBe('completed');
  });

  it('completes a consignment whose last pickup a background shop collects', async () => {
    // A fresh demo: the goods are hub-checked but the KV consignment has not arrived yet.
    await app.close();
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    const kv = await consignmentFor(KV_IPOH);
    const lines = await app.prisma.allocation.findMany({
      where: { consignmentId: kv.id, pickupId: { not: null } },
      select: { pickupId: true },
    });
    const ids = [...new Set(lines.map((l) => l.pickupId!))];
    const pickups = await app.prisma.pickup.findMany({
      where: { id: { in: ids } },
      select: { id: true, shopId: true },
    });
    const bgShops = await app.prisma.shop.findMany({
      where: { id: { in: pickups.map((x) => x.shopId) }, isBackground: true },
      select: { id: true },
    });
    const background = pickups
      .filter((x) => bgShops.some((b) => b.id === x.shopId))
      .map((x) => x.id);
    expect(background.length).toBeGreaterThan(0);
    // Every real shop's pickup is done already, so the background shops' are the last ones.
    await app.prisma.pickup.updateMany({
      where: { id: { in: ids.filter((id) => !background.includes(id)) } },
      data: { status: 'collected' },
    });
    await moveConsignment(app, kv.id, 'dispatched');
    await moveConsignment(app, kv.id, 'arrived');
    expect(
      await app.prisma.pickupCollection.count({
        where: { pickupId: { in: background }, method: 'system' },
      }),
    ).toBeGreaterThanOrEqual(background.length);
    expect((await consignmentFor(KV_IPOH)).status).toBe('completed');
  });

  it('shows staff upcoming pickups with codes and places but no money (stories 100, 99)', async () => {
    const rahim = await app.as('rahim');
    const res = await rahim.get(`/api/shops/${KEDAI}/pickups?status=upcoming`);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      pickupId: p.id,
      destinationType: 'pickup_point',
      placeName: 'Ipoh pickup point',
      openingHours: '10 am–7 pm daily',
      deliveryDate: DATE,
      status: 'ready',
      statusLabel: 'Ready for pickup',
      code: p.code,
    });
    expect(res.body.items[0].address).toEqual(expect.any(String));
    expect(res.body.items[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          allocationId: expect.any(String),
          productName: expect.any(String),
          unitName: expect.any(String),
          quantity: expect.any(Number),
        }),
      ]),
    );
    expectNoMoneyFields(res.body);
  });

  it('shows the owner the same pickups, without money either', async () => {
    const owner = await app.as('ahSeng');
    const res = await owner.get(`/api/shops/${KEDAI}/pickups`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { pickupId: string }) => i.pickupId)).toContain(p.id);
    expectNoMoneyFields(res.body);
  });

  it('moves a collected pickup from upcoming to past', async () => {
    const rahim = await app.as('rahim');
    await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    const upcoming = await rahim.get(`/api/shops/${KEDAI}/pickups?status=upcoming`);
    expect(upcoming.body.items.map((i: { pickupId: string }) => i.pickupId)).not.toContain(p.id);
    const past = await rahim.get(`/api/shops/${KEDAI}/pickups?status=past`);
    expect(past.body.items).toEqual([
      expect.objectContaining({ pickupId: p.id, status: 'collected', statusLabel: 'Collected' }),
    ]);
  });

  it("hides another shop's pickups", async () => {
    const siti = await app.as('siti');
    expect((await siti.get(`/api/shops/${KEDAI}/pickups`)).status).toBe(404);
    const res = await siti.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(res.status).toBe(404);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
  });

  it('answers 404 for an unknown pickup', async () => {
    const rahim = await app.as('rahim');
    const res = await rahim.post(`/api/pickups/not-a-pickup/collect`, { code: p.code });
    expect(res.status).toBe(404);
  });
});

describe('Collecting a pickup that is not ready', () => {
  it('refuses to collect a pickup that is not ready', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('waiting');
    const rahim = await app.as('rahim');
    const res = await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_READY');
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('waiting');
  });
});

describe('A line leaving active frees a waiting pickup (C4 gate 1)', () => {
  /**
   * Condensed milk cuts off an hour before Kedai Kopi Contoh's other rounds, reaches the hub and
   * arrives at Ipoh while those lines are still active, so the pickup waits on them alone.
   */
  async function cmArrivedOthersActive() {
    app = await createTestApp({ seed: 'demo' });
    await setupKedaiKopi(app);
    await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', '2026-W45'))!);
    const cm = await roundOf('CM', '2026-W45');
    await app.adminQuery(
      `update rounds set cutoff_at = cutoff_at + interval '1 hour' where status = 'open' and id <> $1`,
      [cm.id],
    );
    const skipped = await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
    expect(skipped.status).toBe(200);
    await toHubChecked(app, ['CM']);
    await arriveAtIpoh([KV_IPOH]);
    const others = await app.prisma.participation.findMany({
      where: { shopId: KEDAI, status: 'active' },
      select: { id: true, roundId: true },
    });
    expect(others.length).toBeGreaterThan(0);
    // The condensed milk can be collected on its own (P1-8), but the pickup is not ready.
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('partly_ready');
    return others;
  }

  it('readies the pickup when the owner cancels the last active line', async () => {
    const others = await cmArrivedOthersActive();
    const ahSeng = await app.as('ahSeng');
    for (const { id } of others) {
      expect((await ahSeng.post(`/api/participations/${id}/cancel`)).status).toBe(200);
    }
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
  });

  it('readies the pickup when the last active rounds close without keeping the lines', async () => {
    const others = await cmArrivedOthersActive();
    const roundIds = [...new Set(others.map((o) => o.roundId))];
    // Nobody reaches the minimum, so every line is refunded at the cut-off.
    await app.adminQuery(
      `update rounds set tiers_snapshot = (
         select jsonb_agg(t || jsonb_build_object('minQuantity', (t->>'minQuantity')::int + 1000000))
         from jsonb_array_elements(tiers_snapshot) t)
       where id = any($1::uuid[])`,
      [roundIds],
    );
    app.clock.advance(2 * 3_600_000);
    for (const id of roundIds) {
      expect((await closeRoundById(app.deps, id)).outcome).toBe('failed');
    }
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('ready');
  });
});

describe('Door delivery handover', () => {
  it('marks a door pickup delivered with the code and tells owner and staff', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, GERAI_ROUNDS);
    const door = await consignmentFor(GERAI_DOOR);
    await moveConsignment(app, door.id, 'dispatched');
    await moveConsignment(app, door.id, 'out_for_delivery');
    const p = await pickupOf('GERAI', DATE);
    expect(p.status).toBe('out_for_delivery');

    const kumar = await app.as('kumar');
    const before = await kumar.get(`/api/shops/${GERAI}/pickups?status=upcoming`);
    expect(before.body.items[0]).toMatchObject({
      pickupId: p.id,
      destinationType: 'door',
      placeName: null,
      openingHours: null,
      statusLabel: 'Out for delivery',
    });
    expectNoMoneyFields(before.body);

    // The history week's door delivery was announced a week earlier.
    const announced = await countWhatsapp('siti', 'pickup.delivered');
    const res = await kumar.post(`/api/pickups/${p.id}/collect`, { code: p.code });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'delivered', statusLabel: 'Delivered' });
    const e = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'fulfilment.delivered', subjectId: p.id },
    });
    expect(e.shopId).toBe(GERAI);
    const text = 'Your goods were delivered. Please check them now.';
    expect(await lastWhatsapp('siti', 'pickup.delivered')).toBe(text);
    expect(await lastWhatsapp('kumar', 'pickup.delivered')).toBe(text);
    expect(await countWhatsapp('siti', 'pickup.delivered')).toBe(announced + 1);
  });
});

describe('Pickup tracker labels (story 71)', () => {
  type Item = { pickupId: string | null; deliveryDate: string; statusLabel: string };
  const kedaiItem = async (): Promise<Item> => {
    const res = await (await app.as('ahSeng')).get(`/api/shops/${KEDAI}/pickups?status=upcoming`);
    expect(res.status).toBe(200);
    expectNoMoneyFields(res.body);
    const item = (res.body.items as Item[]).find((i) => i.deliveryDate === DATE);
    expect(item).toBeDefined();
    return item!;
  };

  it('labels each stage the way owners read it', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toFormed(app);
    expect(await kedaiItem()).toMatchObject({
      pickupId: null,
      statusLabel: 'Waiting for supplier',
    });

    await toHubChecked(app, KEDAI_ROUNDS);
    expect(await kedaiItem()).toMatchObject({ statusLabel: 'At the hub' });

    const kv = await consignmentFor(KV_IPOH);
    await moveConsignment(app, kv.id, 'dispatched');
    expect(await kedaiItem()).toMatchObject({ statusLabel: 'On the way' });

    await moveConsignment(app, kv.id, 'arrived');
    await arriveAtIpoh([JOHOR_IPOH]);
    expect(await kedaiItem()).toMatchObject({ statusLabel: 'Ready for pickup' });
  });

  it('shows goods the supplier has sent as on their way to the hub', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toFormed(app);
    const rounds = await Promise.all(KEDAI_ROUNDS.map((k) => roundOf(k, '2026-W45')));
    // One round's goods have left the supplier: the rest still waits for theirs.
    await app.prisma.round.update({ where: { id: rounds[0]!.id }, data: { status: 'dispatched' } });
    expect(await kedaiItem()).toMatchObject({ statusLabel: 'Waiting for supplier' });

    // Every round's goods have left their suppliers but none is hub-checked yet.
    await app.prisma.round.updateMany({
      where: { id: { in: rounds.map((r) => r.id) } },
      data: { status: 'dispatched' },
    });
    expect(await kedaiItem()).toMatchObject({
      pickupId: null,
      statusLabel: 'On its way to the hub',
    });
  });

  it('lists goods still with the supplier as their own group beside the pickup', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, ['CM']);
    const p = await pickupOf('KEDAI_KOPI', DATE);
    const res = await (await app.as('rahim')).get(`/api/shops/${KEDAI}/pickups?status=upcoming`);
    expect(res.status).toBe(200);
    expectNoMoneyFields(res.body);
    const onDate = (res.body.items as (Item & { code: string | null })[]).filter(
      (i) => i.deliveryDate === DATE,
    );
    expect(onDate).toEqual([
      expect.objectContaining({ pickupId: p.id, code: p.code, statusLabel: 'At the hub' }),
      expect.objectContaining({
        pickupId: null,
        code: null,
        statusLabel: 'Waiting for supplier',
        lines: expect.arrayContaining([expect.objectContaining({ allocationId: null })]),
      }),
    ]);
    // The pickup lists only its hub-checked goods.
    expect(onDate[0]).toMatchObject({
      lines: [expect.objectContaining({ allocationId: expect.any(String) })],
    });
  });
});
