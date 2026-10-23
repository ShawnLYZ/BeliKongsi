import { PRODUCTS } from '../../../prisma/seed/catalogue';
import { seedId, type SeedUserKey } from '../../../prisma/seed/ids';
import { SAMPLE_USUAL_PRICES_SEN } from '../../../prisma/seed/sample-order';
import type { PaymentSummary } from '@/lib/views/payments';
import { getDeps } from '@/server/platform/deps';
import type { TestApp } from './app';
import { callRoute } from './route';

const p = (key: string) => seedId('product', key);
const productKeyOf = new Map(PRODUCTS.map((x, i) => [p(x.key), { key: x.key, order: i }]));

/**
 * Kedai Kopi Contoh finishes setup: Ipoh pickup point, then the usual list from the sample order
 * (`CM` 6, `OIL` 2, `EGG_A` 10, `COFFEE` 1, `CUPS` 2) at the sample prices.
 */
export async function setupKedaiKopi(app: TestApp): Promise<{ shopId: string }> {
  const shopId = seedId('shop', 'KEDAI_KOPI');
  const owner = await app.as('ahSeng');
  const settings = await owner.patch(`/api/shops/${shopId}/settings`, {
    defaultFulfilment: 'pickup',
    pickupPointId: seedId('pickup_point', 'PP_IPOH'),
  });
  if (settings.status !== 200) throw new Error(`settings failed: ${settings.status}`);
  const prices = SAMPLE_USUAL_PRICES_SEN;
  const saved = await owner.put(`/api/shops/${shopId}/usual-list`, {
    items: [
      { productId: p('CM'), quantity: 6, usualPriceSen: prices.CM },
      { productId: p('OIL'), quantity: 2, usualPriceSen: prices.OIL },
      { productId: p('EGG_A'), quantity: 10, usualPriceSen: prices.EGG_A },
      { productId: p('COFFEE'), quantity: 1, usualPriceSen: prices.COFFEE },
      { productId: p('CUPS'), quantity: 2, usualPriceSen: prices.CUPS },
    ],
  });
  if (saved.status !== 200) throw new Error(`usual list failed: ${saved.status}`);
  return { shopId };
}

/** The id of a shop's basket for an ISO week, or undefined when it has none. */
export async function basketIdOf(shopKey: string, week: string): Promise<string | undefined> {
  const row = await getDeps().prisma.weeklyBasket.findUnique({
    where: { shopId_basketWeek: { shopId: seedId('shop', shopKey), basketWeek: week } },
    select: { id: true },
  });
  return row?.id;
}

/** A shop's basket for an ISO week with its lines, each carrying its `productKey`, in catalogue order. */
export async function basketOf(shopKey: string, week: string) {
  const basket = await getDeps().prisma.weeklyBasket.findUniqueOrThrow({
    where: { shopId_basketWeek: { shopId: seedId('shop', shopKey), basketWeek: week } },
    include: { lines: true },
  });
  const lines = basket.lines
    .map((l) => ({ ...l, productKey: productKeyOf.get(l.productId)!.key }))
    .sort((a, b) => productKeyOf.get(a.productId)!.order - productKeyOf.get(b.productId)!.order);
  return { ...basket, lines };
}

/**
 * The owner approves the basket and, unless the balance covered it, pays on the simulated
 * checkout with DuitNow QR. Returns the approval's summary with the final status.
 */
export async function payBasket(
  app: TestApp,
  userKey: SeedUserKey,
  basketId: string,
): Promise<PaymentSummary> {
  const owner = await app.as(userKey);
  const approved = await owner.post(`/api/baskets/${basketId}/approve`, undefined, {
    'idempotency-key': `pay-basket-${basketId}`,
  });
  if (approved.status !== 200) throw new Error(`approve failed: ${approved.status}`);
  const summary = approved.body as PaymentSummary;
  if (summary.status === 'succeeded') return summary;
  const paid = await owner.post(`/api/payments/${summary.paymentId}/simulate`, {
    outcome: 'succeeded',
    method: 'duitnow_qr',
  });
  if (paid.status !== 200 || paid.body.status !== 'succeeded') {
    throw new Error(`simulated payment failed: ${paid.status}`);
  }
  return { ...summary, status: 'succeeded', checkoutUrl: null };
}

/** A shop's latest participation in a round of the product. Throws when it has none. */
export async function participationOf(shopKey: string, productKey: string) {
  return getDeps().prisma.participation.findFirstOrThrow({
    where: { shopId: seedId('shop', shopKey), round: { productId: p(productKey) } },
    orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
  });
}

/** A shop's delivery fee charge for a door delivery date (`YYYY-MM-DD`), or null when it has none. */
export async function feeChargeOf(shopKey: string, date: string) {
  return getDeps().prisma.deliveryFeeCharge.findUnique({
    where: { shopId_deliveryDate: { shopId: seedId('shop', shopKey), deliveryDate: date } },
  });
}

/** Active units in each product's open round, keyed by product key (0 for an empty round). */
export async function totalsByProductKey(app: TestApp): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const product of PRODUCTS) {
    const round = await app.prisma.round.findFirstOrThrow({
      where: { productId: p(product.key), status: 'open' },
      select: { id: true },
    });
    const sum = await app.prisma.participation.aggregate({
      where: { roundId: round.id, status: 'active' },
      _sum: { quantity: true },
    });
    totals[product.key] = sum._sum.quantity ?? 0;
  }
  return totals;
}

/** A product's round for an ISO week (its `cycleLabel`, such as `2026-W45`). Throws when it has none. */
export async function roundOf(productKey: string, week: string) {
  return getDeps().prisma.round.findFirstOrThrow({
    where: { productId: p(productKey), cycleLabel: week },
    orderBy: [{ opensAt: 'desc' }, { id: 'desc' }],
  });
}

/** The supplier order drafted for a round. Throws when there is none. */
export async function supplierOrderOf(roundId: string) {
  return getDeps().prisma.supplierOrder.findUniqueOrThrow({ where: { roundId } });
}

/** A product's open round. Throws when it has none. */
export async function openRoundOf(productKey: string) {
  return getDeps().prisma.round.findFirstOrThrow({
    where: { productId: p(productKey), status: 'open' },
  });
}

/**
 * The text of the latest WhatsApp-ready notification of a type sent to a user (newest first).
 * `contains`, when given, keeps only messages whose text includes it, ignoring case.
 */
export async function lastWhatsapp(
  userKey: SeedUserKey,
  type: string,
  contains?: string,
): Promise<string | undefined> {
  const rows = await getDeps().prisma.notification.findMany({
    where: { userId: seedId('user', userKey), type },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { whatsappText: true },
  });
  const needle = contains?.toLowerCase();
  return rows.find((r) => !needle || r.whatsappText.toLowerCase().includes(needle))?.whatsappText;
}

/** How many notifications of a type a user has. */
export async function countWhatsapp(userKey: SeedUserKey, type: string): Promise<number> {
  return getDeps().prisma.notification.count({ where: { userId: seedId('user', userKey), type } });
}

export const SUP_DRY = seedId('supplier', 'SUP_DRY');

/**
 * Kedai Kopi Contoh sets up and pays its basket, then the demo skips to the cut-off: the formed
 * rounds each have a supplier order waiting for Ops.
 */
export async function toFormed(app: TestApp): Promise<void> {
  await setupKedaiKopi(app);
  await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', '2026-W45'))!);
  const res = await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
  if (res.status !== 200) throw new Error(`skip to cut-off failed: ${res.status}`);
}

/** A supplier order by id. Throws when there is none. */
export async function order(id: string) {
  return getDeps().prisma.supplierOrder.findUniqueOrThrow({ where: { id } });
}

/** A round by id. Throws when there is none. */
export async function round(id: string) {
  return getDeps().prisma.round.findUniqueOrThrow({ where: { id } });
}

/** The id of the Ops approval for a supplier order. Throws when it has none. */
export async function opsApprovalOf(supplierOrderId: string): Promise<string> {
  const row = await getDeps().prisma.approvalRequest.findFirstOrThrow({
    where: { type: 'supplier_order', subjectId: supplierOrderId },
    select: { id: true },
  });
  return row.id;
}

/** The id of the supplier's confirmation approval for a supplier order. Throws when it has none. */
export async function supplierApprovalOf(supplierOrderId: string): Promise<string> {
  const row = await getDeps().prisma.approvalRequest.findFirstOrThrow({
    where: { type: 'supplier_confirmation', subjectId: supplierOrderId },
    select: { id: true },
  });
  return row.id;
}

/** Every shop's name. */
export async function allShopNames(): Promise<string[]> {
  const rows = await getDeps().prisma.shop.findMany({ select: { name: true } });
  return rows.map((r) => r.name);
}

/** Every shop's id. */
export async function allShopIds(): Promise<string[]> {
  const rows = await getDeps().prisma.shop.findMany({ select: { id: true } });
  return rows.map((r) => r.id);
}

const SUPPLIER_USER: Record<string, SeedUserKey> = {
  SUP_DRY: 'farid',
  SUP_EGG: 'lim',
  SUP_PACK: 'priya',
};

/**
 * Takes the named W45 rounds through Ops approval, supplier confirmation, dispatch and the hub
 * check (every accepted unit good unless `goodUnits` says otherwise). Runs `toFormed` first when
 * the demo has not reached the cut-off yet, so it can be called again for further rounds.
 */
export async function toHubChecked(
  app: TestApp,
  productKeys: string[],
  opts: { goodUnits?: number } = {},
): Promise<void> {
  const first = await roundOf(productKeys[0]!, '2026-W45');
  const formed = await getDeps().prisma.supplierOrder.findUnique({ where: { roundId: first.id } });
  if (!formed) await toFormed(app);
  const nadia = await app.as('nadia');
  for (const key of productKeys) {
    const so = await supplierOrderOf((await roundOf(key, '2026-W45')).id);
    const supplierKey = PRODUCTS.find((x) => x.key === key)!.supplier;
    const supplier = await app.as(SUPPLIER_USER[supplierKey]!);
    const ops = await nadia.post(`/api/approvals/${await opsApprovalOf(so.id)}/approve`, {});
    if (ops.status !== 200) throw new Error(`Ops approval of ${key} failed: ${ops.status}`);
    const sup = await supplier.post(`/api/approvals/${await supplierApprovalOf(so.id)}/approve`, {
      expectedDispatchDate: '2026-11-07',
    });
    if (sup.status !== 200) throw new Error(`supplier approval of ${key} failed: ${sup.status}`);
    const sent = await supplier.post(`/api/supplier-orders/${so.id}/dispatched`);
    if (sent.status !== 200) throw new Error(`dispatch of ${key} failed: ${sent.status}`);
    const checked = await nadia.post(`/api/supplier-orders/${so.id}/hub-check`, {
      goodUnits: opts.goodUnits ?? so.acceptedQuantity,
      damagedUnits: 0,
    });
    if (checked.status !== 200) throw new Error(`hub check of ${key} failed: ${checked.status}`);
  }
}

/**
 * The consignment from a hub (seed key) to a destination key on a delivery date: the given wave,
 * else the latest one. Throws when there is none.
 */
export async function consignmentFor(where: {
  hub: string;
  destinationKey: string;
  deliveryDate: string;
  wave?: number;
}) {
  return getDeps().prisma.consignment.findFirstOrThrow({
    where: {
      hubId: seedId('hub', where.hub),
      destinationKey: where.destinationKey,
      deliveryDate: where.deliveryDate,
      ...(where.wave === undefined ? {} : { wave: where.wave }),
    },
    orderBy: { wave: 'desc' },
  });
}

/** A shop's pickup for a delivery date (`YYYY-MM-DD`). Throws when it has none. */
export async function pickupOf(shopKey: string, deliveryDate: string) {
  return getDeps().prisma.pickup.findFirstOrThrow({
    where: { shopId: seedId('shop', shopKey), deliveryDate },
    orderBy: { createdAt: 'asc' },
  });
}

/** The allocation of a shop's latest participation in a product's rounds. Throws when it has none. */
export async function allocationOf(shopKey: string, productKey: string) {
  const part = await participationOf(shopKey, productKey);
  return getDeps().prisma.allocation.findUniqueOrThrow({ where: { participationId: part.id } });
}

/** Nadia (Ops) moves a consignment to a status through the API. Throws unless it answers 200. */
export async function moveConsignment(app: TestApp, consignmentId: string, status: string) {
  const nadia = await app.as('nadia');
  const res = await nadia.post(`/api/consignments/${consignmentId}/status`, { status });
  if (res.status !== 200) throw new Error(`moving consignment to ${status} failed: ${res.status}`);
  return res.body;
}

/**
 * Uploads a small JPEG to a pickup the way the browser does: asks for a signed link, then PUTs
 * the bytes. Returns the photo id. Throws unless both steps answer 200.
 */
export async function uploadPhoto(
  client: { post(path: string, body?: unknown): Promise<{ status: number; body: unknown }> },
  pickupId: string,
  sizeBytes = 2048,
): Promise<string> {
  const asked = await client.post(`/api/pickups/${pickupId}/photos`, {
    contentType: 'image/jpeg',
    sizeBytes,
  });
  if (asked.status !== 200) throw new Error(`photo request failed: ${asked.status}`);
  const { photoId, upload } = asked.body as {
    photoId: string;
    upload: { url: string; headers: Record<string, string> };
  };
  const put = await callRoute('PUT', upload.url, {
    body: new Uint8Array(sizeBytes).fill(0xff),
    headers: upload.headers,
  });
  if (put.status !== 200) throw new Error(`photo upload failed: ${put.status}`);
  return photoId;
}
