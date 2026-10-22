import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import {
  basketIdOf,
  countWhatsapp,
  lastWhatsapp,
  openRoundOf,
  payBasket,
  setupKedaiKopi,
} from './helpers/scenarios';

const WEEK = '2026-W45';
const CUTOFF = '2026-11-05T12:00:00Z';

let app: TestApp;

const joinAndPay = async (client: Client, roundId: string, body: object) => {
  const res = await client.post(`/api/rounds/${roundId}/participations`, body);
  if (res.status !== 200) throw new Error(`join failed: ${res.status} ${JSON.stringify(res.body)}`);
  const paid = await client.post(`/api/payments/${res.body.paymentId}/simulate`, {
    outcome: 'succeeded',
    method: 'duitnow_qr',
  });
  if (paid.status !== 200) throw new Error(`payment failed: ${paid.status}`);
};

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  const basketId = (await basketIdOf('KEDAI_KOPI', WEEK))!;
  const added = await (
    await app.as('rahim')
  ).post(`/api/baskets/${basketId}/lines`, { productId: seedId('product', 'EM'), quantity: 1 });
  if (added.status !== 200) throw new Error(`staff add failed: ${added.status}`);
  await payBasket(app, 'ahSeng', basketId);
});

afterEach(async () => {
  await app.close();
});

describe('telling owners the result of a round', () => {
  it('tells Kedai Kopi Contoh its condensed milk result (story 66)', async () => {
    app.clock.set(CUTOFF);
    await closeDueRounds(app.deps);
    expect(await lastWhatsapp('ahSeng', 'round.kept', 'condensed milk')).toBe(
      'Condensed milk closed at RM 146.00 a carton (105 cartons, 9 shops). RM 73.44 is back in your balance. Ready Tue 10 Nov.',
    );
    const note = await app.prisma.notification.findFirstOrThrow({
      where: { userId: seedId('user', 'ahSeng'), type: 'round.kept' },
    });
    expect(note.link).toBe('/owner/kongsi');
  });

  it('tells Kafe Contoh its eggs were dropped', async () => {
    app.clock.set(CUTOFF);
    await closeDueRounds(app.deps);
    expect(await lastWhatsapp('mei', 'round.dropped')).toBe(
      'Grade B eggs closed at RM 12.33 all-in, above your limit of RM 12.20. Full refund: RM 123.30.',
    );
  });

  it('tells an owner when a round fails, with the next closing date', async () => {
    // Kedai Kopi also joins TEA 2 at Ipoh (paid 2 × 17498) → TEA total 8 → fails.
    await joinAndPay(await app.as('ahSeng'), (await openRoundOf('TEA')).id, { quantity: 2 });
    app.clock.set(CUTOFF);
    await closeDueRounds(app.deps);
    expect(await lastWhatsapp('ahSeng', 'round.failed')).toBe(
      "Tea dust didn't reach 10 cartons. Full refund: RM 349.96. Next round closes Thu 12 Nov.",
    );
  });

  it('combines two participations in one round into one message', async () => {
    // Kedai Kopi joins CM 2 more from the catalogue before cut-off.
    await joinAndPay(await app.as('ahSeng'), (await openRoundOf('CM')).id, { quantity: 2 });
    app.clock.set(CUTOFF);
    await closeDueRounds(app.deps);
    // One message per product kept: CM, EM, OIL, EGG_A, COFFEE, CUPS.
    expect(await countWhatsapp('ahSeng', 'round.kept')).toBe(6);
    const cm = await app.prisma.notification.findMany({
      where: {
        userId: seedId('user', 'ahSeng'),
        type: 'round.kept',
        whatsappText: { startsWith: 'Condensed milk' },
      },
    });
    expect(cm).toHaveLength(1);
    expect(cm[0]!.whatsappText).toContain('RM 97.92 is back');
  });

  it('sends nothing to staff, background shops or for empty rounds', async () => {
    app.clock.set(CUTOFF);
    await closeDueRounds(app.deps);
    expect(await countWhatsapp('rahim', 'round.kept')).toBe(0);
    const all = await app.prisma.notification.findMany({
      where: { type: { startsWith: 'round.' } },
    });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((n) => n.role === 'owner')).toBe(true);
    expect(all.some((n) => /paper bags/i.test(n.whatsappText))).toBe(false);
    const shopIds = [...new Set(all.map((n) => n.shopId!))];
    const background = await app.prisma.shop.count({
      where: { id: { in: shopIds }, isBackground: true },
    });
    expect(background).toBe(0);
  });
});
