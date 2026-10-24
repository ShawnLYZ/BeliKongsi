import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { formatMytDate, formatPickupCode } from '@/lib/format';
import { enforceCheckWindow, remindUncollected } from '@/server/modules/fulfilment/reminders';
import { runDueJobs } from '@/server/modules/jobs/run';
import { createTestApp, type TestApp } from './helpers/app';
import {
  allocationOf,
  consignmentFor,
  countWhatsapp,
  lastWhatsapp,
  moveConsignment,
  participationOf,
  pickupOf,
  toHubChecked,
  uploadPhoto,
} from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const DATE = '2026-11-10';
const KV_IPOH = { hub: 'HUB_KV', destinationKey: `pp:${PP_IPOH}`, deliveryDate: DATE };
const JOHOR_IPOH = { ...KV_IPOH, hub: 'HUB_JOHOR' };
const GERAI_DOOR = { hub: 'HUB_KV', destinationKey: `door:${GERAI}`, deliveryDate: DATE };
const KEDAI_ROUNDS = ['CM', 'OIL', 'EGG_A', 'COFFEE', 'CUPS'];
const GERAI_ROUNDS = ['CM', 'EM', 'FLOUR', 'CONT'];
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

let app: TestApp;

afterEach(async () => {
  await app.close();
});

/** Sets the time the jobs see, whatever offset the demo's skip to the cut-off left behind. */
async function at(ms: number): Promise<void> {
  const { clockOffsetMs } = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
  app.clock.set(new Date(ms - Number(clockOffsetMs)).toISOString());
}

/** Both consignments reach Ipoh, so Kedai Kopi's pickup is ready. */
async function arriveAtIpoh() {
  for (const where of [KV_IPOH, JOHOR_IPOH]) {
    const c = await consignmentFor(where);
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
  }
}

const opsNotices = () =>
  app.prisma.notification.findMany({
    where: { type: 'ops.goods_uncollected', whatsappText: { contains: 'Kedai Kopi Contoh' } },
  });

describe('Goods waiting at the pickup point', () => {
  let readyAt: number;
  let code: string;

  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    await arriveAtIpoh();
    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('ready');
    readyAt = p.readyAt!.getTime();
    code = formatPickupCode(p.code);
  });

  /** Runs the reminder job twice at a time, as a cron that fires every few minutes would. */
  async function runTwiceAt(ms: number) {
    await at(ms);
    await remindUncollected(app.deps);
    await remindUncollected(app.deps);
  }

  it('reminds on day 1 and day 3 and alerts Ops on day 7, once each (stories 75, 135)', async () => {
    await runTwiceAt(readyAt + 24 * HOUR - MIN);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(0);

    await runTwiceAt(readyAt + 24 * HOUR);
    const text = `Your goods are waiting at Ipoh pickup point (10 am–7 pm daily). Pickup code ${code}.`;
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(1);
    expect(await countWhatsapp('rahim', 'pickup.uncollected')).toBe(1);
    expect(await lastWhatsapp('ahSeng', 'pickup.uncollected')).toBe(text);
    expect(await lastWhatsapp('rahim', 'pickup.uncollected')).toBe(text);

    await runTwiceAt(readyAt + 72 * HOUR - MIN);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(1);
    await runTwiceAt(readyAt + 72 * HOUR);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(2);
    expect(await countWhatsapp('rahim', 'pickup.uncollected')).toBe(2);
    expect(await opsNotices()).toHaveLength(0);

    await runTwiceAt(readyAt + 168 * HOUR - MIN);
    expect(await opsNotices()).toHaveLength(0);
    await runTwiceAt(readyAt + 168 * HOUR);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(2);
    expect(await countWhatsapp('rahim', 'pickup.uncollected')).toBe(2);
    expect(await countWhatsapp('nadia', 'ops.goods_uncollected')).toBeGreaterThan(0);
    const [alert] = await opsNotices();
    expect(alert!.whatsappText).toBe(
      'Goods uncollected for 7 days: Kedai Kopi Contoh at Ipoh pickup point.',
    );
    expect(await opsNotices()).toHaveLength(1);
    // Ops hear about each pickup once, and shop staff never get the Ops alert.
    expect(await countWhatsapp('rahim', 'ops.goods_uncollected')).toBe(0);
  });

  it('keeps staff notices free of amounts', async () => {
    await runTwiceAt(readyAt + 24 * HOUR);
    expect(await lastWhatsapp('rahim', 'pickup.uncollected')).not.toMatch(/RM\s?\d/);
  });

  it('stops once the goods are collected', async () => {
    await at(readyAt + 2 * HOUR);
    const p = await pickupOf('KEDAI_KOPI', DATE);
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    await runTwiceAt(readyAt + 30 * HOUR);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(0);
  });

  it('counts a partly ready pickup from when it last became ready', async () => {
    // Back to a clean demo with only the Johor eggs at Ipoh.
    await app.close();
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    const c = await consignmentFor(JOHOR_IPOH);
    await moveConsignment(app, c.id, 'dispatched');
    await moveConsignment(app, c.id, 'arrived');
    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('partly_ready');
    await runTwiceAt(p.readyAt!.getTime() + 24 * HOUR);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(1);
  });

  it('reminds again about the rest of a pickup collected in parts', async () => {
    await app.close();
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    const johor = await consignmentFor(JOHOR_IPOH);
    await moveConsignment(app, johor.id, 'dispatched');
    await moveConsignment(app, johor.id, 'arrived');
    const p = await pickupOf('KEDAI_KOPI', DATE);
    expect(p.status).toBe('partly_ready');

    // The eggs wait a day, get their day-1 reminder, and are collected.
    const firstReady = p.readyAt!.getTime();
    await runTwiceAt(firstReady + 24 * HOUR);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(1);
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);

    // The rest arrives later: it is ready again, with its own day-1 reminder, once.
    await at(firstReady + 48 * HOUR);
    const kv = await consignmentFor(KV_IPOH);
    await moveConsignment(app, kv.id, 'dispatched');
    await moveConsignment(app, kv.id, 'arrived');
    const again = await pickupOf('KEDAI_KOPI', DATE);
    expect(again.status).toBe('ready');
    const secondReady = again.readyAt!.getTime();
    await runTwiceAt(secondReady + 24 * HOUR - MIN);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(1);
    await runTwiceAt(secondReady + 24 * HOUR);
    expect(await countWhatsapp('ahSeng', 'pickup.uncollected')).toBe(2);
    expect(await countWhatsapp('rahim', 'pickup.uncollected')).toBe(2);
  });
});

describe('A door delivery on its way', () => {
  it('is not an uncollected pickup: it is not waiting at a place', async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, GERAI_ROUNDS);
    const door = await consignmentFor(GERAI_DOOR);
    await moveConsignment(app, door.id, 'dispatched');
    await moveConsignment(app, door.id, 'out_for_delivery');
    const p = await pickupOf('GERAI', DATE);
    expect(p.status).toBe('out_for_delivery');
    const before = await countWhatsapp('kumar', 'pickup.uncollected');
    await at(p.readyAt!.getTime() + 200 * HOUR);
    await remindUncollected(app.deps);
    expect(await countWhatsapp('kumar', 'pickup.uncollected')).toBe(before);
    expect(await countWhatsapp('siti', 'pickup.uncollected')).toBe(0);
  });
});

describe('The 72-hour delivery-check window', () => {
  let pickupId: string;
  let collectedAt: number;

  /** Rahim collects Kedai Kopi's goods at Ipoh; nobody checks them. */
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
    await toHubChecked(app, KEDAI_ROUNDS);
    await arriveAtIpoh();
    const p = await pickupOf('KEDAI_KOPI', DATE);
    pickupId = p.id;
    const rahim = await app.as('rahim');
    expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).status).toBe(200);
    const [collection] = await app.prisma.pickupCollection.findMany({ where: { pickupId } });
    collectedAt = collection!.collectedAt.getTime();
  });

  async function runTwiceAt(ms: number) {
    await at(ms);
    await enforceCheckWindow(app.deps);
    await enforceCheckWindow(app.deps);
  }

  const checks = () => app.prisma.deliveryCheck.findMany({ where: { pickupId } });
  const savingOfCm = async () => {
    const ah = await app.as('ahSeng');
    const items = (await ah.get(`/api/shops/${KEDAI}/participations?status=history`)).body
      .items as { shortName: string; savings: { status: string } }[];
    return items.find((i) => i.shortName === 'condensed milk')!.savings.status;
  };

  it('reminds at 24 h and closes as "received, not checked" at 72 h (story 83, P1-10)', async () => {
    await runTwiceAt(collectedAt + 24 * HOUR - MIN);
    expect(await countWhatsapp('ahSeng', 'delivery.check_reminder')).toBe(0);

    await runTwiceAt(collectedAt + 24 * HOUR);
    const text = `Please check the goods you received on ${formatMytDate(new Date(collectedAt))}: tap to confirm or report a problem.`;
    expect(await countWhatsapp('ahSeng', 'delivery.check_reminder')).toBe(1);
    expect(await countWhatsapp('rahim', 'delivery.check_reminder')).toBe(1);
    expect(await lastWhatsapp('ahSeng', 'delivery.check_reminder')).toBe(text);
    expect(await lastWhatsapp('rahim', 'delivery.check_reminder')).toBe(text);
    expect(await checks()).toHaveLength(0);

    await runTwiceAt(collectedAt + 72 * HOUR - MIN);
    expect(await checks()).toHaveLength(0);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('collected');

    await runTwiceAt(collectedAt + 72 * HOUR);
    const [check] = await checks();
    expect(await checks()).toHaveLength(1);
    expect(check).toMatchObject({ result: 'not_checked', submittedByUserId: null });
    expect(await countWhatsapp('ahSeng', 'delivery.check_reminder')).toBe(1);
    expect((await pickupOf('KEDAI_KOPI', DATE)).status).toBe('closed');
    expect((await participationOf('KEDAI_KOPI', 'CM')).status).toBe('closed');
    expect(await app.prisma.claim.count({ where: { shopId: KEDAI } })).toBe(0);
    expect(await savingOfCm()).toBe('estimated');
  });

  it('logs the system check without a person', async () => {
    await runTwiceAt(collectedAt + 72 * HOUR);
    const [check] = await checks();
    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'check.delivery_check_submitted', subjectId: check!.id },
    });
    expect(entry).toMatchObject({ actorType: 'system', shopId: KEDAI });
  });

  it('runs with the other due jobs and reports what it did', async () => {
    await at(collectedAt + 72 * HOUR);
    const report = await runDueJobs(app.deps);
    expect(report.uncheckedClosed).toBe(1);
    expect((await runDueJobs(app.deps)).uncheckedClosed).toBe(0);
  });

  it('still takes a check at 71 h 59 min', async () => {
    await at(collectedAt + 72 * HOUR - MIN);
    const rahim = await app.as('rahim');
    const res = await rahim.post(`/api/pickups/${pickupId}/delivery-check`, { allReceived: true });
    expect(res).toMatchObject({ status: 200, body: { result: 'all_received' } });
  });

  it('refuses a problem report at exactly 72 h (409 CHECK_WINDOW_CLOSED)', async () => {
    await at(collectedAt + 72 * HOUR);
    const rahim = await app.as('rahim');
    const photo = await uploadPhoto(rahim, pickupId);
    const cm = (await allocationOf('KEDAI_KOPI', 'CM')).id;
    const res = await rahim.post(`/api/pickups/${pickupId}/delivery-check`, {
      lines: [{ allocationId: cm, missing: 0, damaged: 1, photoIds: [photo] }],
    });
    expect(res).toMatchObject({ status: 409, body: { code: 'CHECK_WINDOW_CLOSED' } });
    expect(await checks()).toHaveLength(0);
    expect(await app.prisma.claim.count({ where: { shopId: KEDAI } })).toBe(0);
  });

  it('refuses a problem report after the job has closed the delivery', async () => {
    await runTwiceAt(collectedAt + 72 * HOUR);
    await at(collectedAt + 80 * HOUR);
    const rahim = await app.as('rahim');
    const named = await app.prisma.pickupCollection.findFirstOrThrow({ where: { pickupId } });
    const cm = (await allocationOf('KEDAI_KOPI', 'CM')).id;
    for (const extra of [{}, { collectionId: named.id }]) {
      const res = await rahim.post(`/api/pickups/${pickupId}/delivery-check`, {
        lines: [{ allocationId: cm, missing: 1, damaged: 0, photoIds: [] }],
        ...extra,
      });
      expect(res).toMatchObject({ status: 409, body: { code: 'CHECK_WINDOW_CLOSED' } });
    }
    expect(await app.prisma.claim.count({ where: { shopId: KEDAI } })).toBe(0);
  });
});
