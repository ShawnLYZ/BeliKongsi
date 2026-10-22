import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { getDeps } from '@/server/platform/deps';
import { createTestApp, type TestApp } from './helpers/app';
import { moveConsignment, pickupOf, toHubChecked } from './helpers/scenarios';

const PP_IPOH = seedId('pickup_point', 'PP_IPOH');
const BG_IPOH_SHOP = 'BG07'; // a pickup-point shop of Ipoh whose every line is in a checked round
const BG_DOOR_SHOP = 'BG05'; // every fifth background shop takes door delivery
const KEDAI_KOPI = 'KEDAI_KOPI';
const GERAI = 'GERAI';
const DATE = '2026-11-10';

// Every round that forms in the demo week, so no shop is left waiting on an unchecked round.
const FORMED = ['CM', 'EM', 'OIL', 'FLOUR', 'COFFEE', 'CUPS', 'CONT', 'EGG_A'];

let app: TestApp;

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toHubChecked(app, FORMED);
});

afterEach(async () => {
  await app.close();
});

/** Moves every consignment for a destination (any hub, any wave) along its path to a status. */
async function moveAll(destinationKey: string, path: string[]) {
  const all = await getDeps().prisma.consignment.findMany({
    where: { destinationKey, deliveryDate: DATE },
    orderBy: { id: 'asc' },
  });
  expect(all.length).toBeGreaterThan(0);
  for (const status of path) for (const c of all) await moveConsignment(app, c.id, status);
}

const toIpoh = () => moveAll(`pp:${PP_IPOH}`, ['dispatched', 'arrived']);
const doorMoves = (key: string, path: string[]) => moveAll(`door:${seedId('shop', key)}`, path);

describe('Background shop automation', () => {
  it('collects background shops’ pickups automatically, labelled as simulation (story 133)', async () => {
    await toIpoh();
    const bg = await pickupOf(BG_IPOH_SHOP, DATE);
    expect(bg.status).toBe('collected');
    expect(bg.collectedAt).not.toBeNull();
    const e = await getDeps().prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'fulfilment.pickup_collected', subjectId: bg.id },
    });
    expect(e).toMatchObject({ actorType: 'system', reason: 'background shop simulation' });
    const events = await getDeps().prisma.integrationEvent.findMany({
      where: { type: 'pickup.collected' },
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('leaves a real shop’s ready pickup waiting for its code', async () => {
    await toIpoh();
    const real = await pickupOf(KEDAI_KOPI, DATE);
    expect(real.status).toBe('ready');
    const n = await getDeps().prisma.activityLogEntry.count({
      where: { action: 'fulfilment.pickup_collected', subjectId: real.id },
    });
    expect(n).toBe(0);
  });

  it('delivers a background door pickup when its consignment is delivered', async () => {
    await doorMoves(BG_DOOR_SHOP, ['dispatched', 'out_for_delivery']);
    expect((await pickupOf(BG_DOOR_SHOP, DATE)).status).toBe('out_for_delivery');
    await doorMoves(BG_DOOR_SHOP, ['delivered']);
    const p = await pickupOf(BG_DOOR_SHOP, DATE);
    expect(p.status).toBe('delivered');
    const e = await getDeps().prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'fulfilment.delivered', subjectId: p.id },
    });
    expect(e).toMatchObject({ actorType: 'system', reason: 'background shop simulation' });
  });

  it('leaves a real shop’s door pickup alone when delivered', async () => {
    await doorMoves(GERAI, ['dispatched', 'out_for_delivery']);
    await doorMoves(GERAI, ['delivered']);
    expect((await pickupOf(GERAI, DATE)).status).toBe('out_for_delivery');
  });
});
