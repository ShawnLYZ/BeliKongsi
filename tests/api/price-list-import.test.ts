/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { SAMPLE_ORDER_TEXT } from '../../prisma/seed/sample-order';
import type { FakeOrderReader } from '@/server/adapters/ai/fake';
import { redactPersonalData } from '@/server/adapters/ai/redact';
import { AiUnavailableError, type PriceListResult } from '@/server/adapters/ai/types';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { createTestApp, type TestApp } from './helpers/app';
import { openRoundOf, round, SUP_DRY } from './helpers/scenarios';

const CM = seedId('product', 'CM');
const OIL = seedId('product', 'OIL');
const FLOUR = seedId('product', 'FLOUR');
const EGG_A = seedId('product', 'EGG_A');
const PARSE = `/api/suppliers/${SUP_DRY}/price-list/parse`;
const CONFIRM = `/api/suppliers/${SUP_DRY}/price-list/confirm`;

const readFixture = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', 'price-lists', name), 'utf8');

const NEW_CM_TIERS = [
  { minQuantity: 20, unitPriceSen: 15700 },
  { minQuantity: 50, unitPriceSen: 15100 },
  { minQuantity: 100, unitPriceSen: 14500 },
];
const CM_TIERS_SNAPSHOT = [
  { minQuantity: 20, unitPriceSen: 15800 },
  { minQuantity: 50, unitPriceSen: 15200 },
  { minQuantity: 100, unitPriceSen: 14600 },
];

const draft = (over: Partial<PriceListResult['lines'][number]>) => ({
  sourceText: '',
  productId: null,
  proposedName: null,
  packDescription: null,
  unitName: null,
  buyAlonePriceSen: null,
  tiers: [],
  confidence: 0.95,
  note: null,
  ...over,
});

/** What the model answers for dry-goods.txt: prices read as written, the rising oil ladder included. */
const DRY_GOODS_RESULT: PriceListResult = {
  lines: [
    draft({
      sourceText: 'Susu pekat manis 390g (48 tin/ctn) - harga sendiri RM168',
      productId: CM,
      unitName: 'carton',
      buyAlonePriceSen: 16800,
      tiers: NEW_CM_TIERS,
    }),
    draft({
      sourceText: 'Tepung gandum 25kg (guni) - harga sendiri RM68',
      productId: FLOUR,
      unitName: 'sack',
      buyAlonePriceSen: 6800,
      tiers: [
        { minQuantity: 20, unitPriceSen: 6300 },
        { minQuantity: 50, unitPriceSen: 6050 },
        { minQuantity: 100, unitPriceSen: 5800 },
      ],
    }),
    draft({
      sourceText: 'Minyak masak 17kg (tin) - harga sendiri RM115',
      productId: OIL,
      unitName: 'tin',
      buyAlonePriceSen: 11500,
      tiers: [
        { minQuantity: 20, unitPriceSen: 10000 },
        { minQuantity: 50, unitPriceSen: 12000 },
      ],
      confidence: 0.9,
    }),
    draft({
      sourceText: 'BARU: Gula pasir halus 50kg (guni) - harga sendiri RM190',
      proposedName: 'Gula pasir halus 50 kg',
      packDescription: 'sack of 50 kg',
      unitName: 'sack',
      buyAlonePriceSen: 19000,
      tiers: [
        { minQuantity: 10, unitPriceSen: 18000 },
        { minQuantity: 30, unitPriceSen: 17200 },
      ],
      note: 'Not in the catalogue yet.',
    }),
  ],
  ignoredText: ['PEMBEKAL BARANG KERING CONTOH', 'Terima kasih!'],
};

const NEW_SUGAR = {
  name: 'Gula pasir halus 50 kg',
  shortName: 'gula pasir',
  category: 'flour',
  packDescription: 'sack of 50 kg',
  unitName: 'sack',
  unitWeightGrams: 50000,
  buyAlonePriceSen: 19000,
  aliases: ['gula'],
  cadence: 'weekly',
  cutoffWeekday: 4,
  cutoffTime: '20:00',
  tiers: [
    { minQuantity: 10, unitPriceSen: 18000 },
    { minQuantity: 30, unitPriceSen: 17200 },
  ],
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const IMAGE_MARKER = `[image image/jpeg ${JPEG.length} bytes]`;

let app: TestApp;
let fake: FakeOrderReader;
let cmRound: string;
let originalTiers: unknown[];
beforeEach(async () => {
  app = await createTestApp();
  fake = app.deps.ai as FakeOrderReader;
  fake.priceListFixtures[redactPersonalData(readFixture('dry-goods.txt')).text] = DRY_GOODS_RESULT;
  cmRound = (await openRoundOf('CM')).id;
  originalTiers = await app.prisma.priceTier.findMany({ where: { productId: CM } });
});
afterEach(async () => {
  await app.close();
});

const parseDryGoods = async () => {
  const farid = await app.as('farid');
  const res = await farid.post(PARSE, { text: readFixture('dry-goods.txt') });
  expect(res.status).toBe(200);
  return { farid, view: res.body };
};
const tiersOf = async (productId: string) =>
  (await app.prisma.priceTier.findMany({ where: { productId }, orderBy: { position: 'asc' } })).map(
    (t) => ({ minQuantity: t.minQuantity, unitPriceSen: t.unitPriceSen }),
  );

describe('reading a supplier price list', () => {
  it('drafts tier tables from a pasted price list without saving anything (story 114)', async () => {
    const v = (
      await (
        await app.as('farid')
      ).post(`/api/suppliers/${SUP_DRY}/price-list/parse`, {
        text: readFixture('dry-goods.txt'),
      })
    ).body;
    expect(v.lines.find((l: any) => l.productId === CM).tiers).toEqual([
      { minQuantity: 20, unitPriceSen: 15700 },
      { minQuantity: 50, unitPriceSen: 15100 },
      { minQuantity: 100, unitPriceSen: 14500 },
    ]);
    expect(await app.prisma.priceTier.findMany({ where: { productId: CM } })).toEqual(
      originalTiers,
    );
  });

  it('shows the current price next to each matched line and drafts unknown products as new', async () => {
    const { view } = await parseDryGoods();
    const cm = view.lines.find((l: any) => l.productId === CM);
    expect(cm.current).toMatchObject({ buyAlonePriceSen: 16800, tiers: CM_TIERS_SNAPSHOT });
    expect(cm.errors).toEqual([]);
    const sugar = view.lines.find((l: any) => l.proposedName === 'Gula pasir halus 50 kg');
    expect(sugar).toMatchObject({ productId: null, current: null, buyAlonePriceSen: 19000 });
    expect(view.ignoredText).toEqual(['PEMBEKAL BARANG KERING CONTOH', 'Terima kasih!']);
  });

  it('flags a drafted ladder whose prices go up and refuses to confirm it', async () => {
    const { farid, view } = await parseDryGoods();
    const oil = view.lines.find((l: any) => l.productId === OIL);
    expect(oil.errors.map((e: any) => [e.code, e.position])).toContainEqual([
      'PRICE_NOT_DECREASING',
      2,
    ]);
    const r = await farid.post(CONFIRM, {
      suggestionRunId: view.suggestionRunId,
      lines: [
        { productId: CM, patch: { tiers: NEW_CM_TIERS } },
        { productId: OIL, patch: { tiers: oil.tiers } },
      ],
    });
    expect(r).toMatchObject({ status: 422, body: { code: 'INVALID_TIERS' } });
    expect(r.body.details.lineIndex).toBe(1);
    expect(r.body.details.errors.map((e: any) => e.code)).toContain('PRICE_NOT_DECREASING');
    expect(await tiersOf(CM)).toEqual(CM_TIERS_SNAPSHOT);
    expect(await tiersOf(OIL)).toEqual([
      { minQuantity: 20, unitPriceSen: 10800 },
      { minQuantity: 50, unitPriceSen: 10400 },
      { minQuantity: 100, unitPriceSen: 10000 },
    ]);
    const run = await app.prisma.aiSuggestionRun.findUniqueOrThrow({
      where: { id: view.suggestionRunId },
    });
    expect(run.confirmedAt).toBeNull();
  });

  it('applies confirmed lines from the next round only', async () => {
    const { farid, view } = await parseDryGoods();
    const r = await farid.post(CONFIRM, {
      suggestionRunId: view.suggestionRunId,
      lines: [{ productId: CM, patch: { tiers: NEW_CM_TIERS } }],
    });
    expect(r).toMatchObject({ status: 200, body: { updated: 1, created: 0 } });
    expect(await tiersOf(CM)).toEqual(NEW_CM_TIERS);
    expect((await round(cmRound)).tiersSnapshot).toEqual(CM_TIERS_SNAPSHOT);
    app.clock.set('2026-11-05T12:00:00Z');
    await closeDueRounds(app.deps);
    expect((await openRoundOf('CM')).tiersSnapshot).toMatchObject(NEW_CM_TIERS);
  });

  it('creates a confirmed new product with its first round open', async () => {
    const { farid, view } = await parseDryGoods();
    const r = await farid.post(CONFIRM, {
      suggestionRunId: view.suggestionRunId,
      lines: [{ create: NEW_SUGAR }],
    });
    expect(r).toMatchObject({ status: 200, body: { updated: 0, created: 1 } });
    const sugar = await app.prisma.product.findFirstOrThrow({
      where: { name: 'Gula pasir halus 50 kg', supplierId: SUP_DRY },
      include: { rounds: true },
    });
    expect(sugar.buyAlonePriceSen).toBe(19000);
    expect(await tiersOf(sugar.id)).toEqual(NEW_SUGAR.tiers);
    expect(sugar.rounds.filter((x) => x.status === 'open')).toHaveLength(1);
  });

  it('logs the suggestion as the AI and the confirmation as the supplier', async () => {
    const { farid, view } = await parseDryGoods();
    const suggested = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'price_list.ai_suggested' },
    });
    expect(suggested).toMatchObject({
      actorType: 'ai',
      supplierId: SUP_DRY,
      subjectId: view.suggestionRunId,
      aiMetadata: { lineCount: 4, suggestionRunId: view.suggestionRunId },
    });
    await farid.post(CONFIRM, {
      suggestionRunId: view.suggestionRunId,
      lines: [
        { productId: CM, patch: { tiers: NEW_CM_TIERS } },
        { productId: FLOUR, patch: { tiers: [{ minQuantity: 20, unitPriceSen: 6200 }] } },
        { create: NEW_SUGAR },
      ],
    });
    const confirmed = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'price_list.confirmed' },
    });
    expect(confirmed).toMatchObject({
      actorType: 'person',
      actorUserId: seedId('user', 'farid'),
      supplierId: SUP_DRY,
      subjectId: view.suggestionRunId,
      after: {
        updated: 2,
        created: 1,
        changeSummary: { acceptedUnchanged: 1, changed: 1, added: 1, removed: 1 },
      },
    });
    const run = await app.prisma.aiSuggestionRun.findUniqueOrThrow({
      where: { id: view.suggestionRunId },
    });
    expect(run.confirmedAt).toEqual(app.clock.now());
    expect(run.changeSummary).toEqual({ acceptedUnchanged: 1, changed: 1, added: 1, removed: 1 });
  });

  it('stores the run for the supplier with the phone number removed', async () => {
    const { view } = await parseDryGoods();
    const run = await app.prisma.aiSuggestionRun.findUniqueOrThrow({
      where: { id: view.suggestionRunId },
    });
    expect(run).toMatchObject({
      kind: 'price_list',
      status: 'succeeded',
      supplierId: SUP_DRY,
      shopId: null,
    });
    expect(run.redactedInput).toContain('[phone removed]');
    expect(run.redactedInput).not.toContain('345 6789');
    expect(fake.received.at(-1)).not.toContain('345 6789');
  });

  it('turns an invented product id into a new-product draft', async () => {
    fake.priceListFixtures['one line'] = {
      lines: [draft({ productId: 'not-a-real-id', buyAlonePriceSen: 5000 })],
      ignoredText: [],
    };
    fake.priceListFixtures['egg line'] = {
      lines: [draft({ productId: EGG_A, buyAlonePriceSen: 1320 })],
      ignoredText: [],
    };
    const farid = await app.as('farid');
    expect((await farid.post(PARSE, { text: 'one line' })).body.lines[0].productId).toBeNull();
    // Another supplier's product is not one this supplier can update.
    expect((await farid.post(PARSE, { text: 'egg line' })).body.lines[0].productId).toBeNull();
  });

  it('reports prices that are not whole sen', async () => {
    fake.priceListFixtures['half sen'] = {
      lines: [
        draft({
          productId: CM,
          buyAlonePriceSen: 16800.5,
          tiers: [{ minQuantity: 20, unitPriceSen: 15700.5 }],
        }),
      ],
      ignoredText: [],
    };
    const l = (await (await app.as('farid')).post(PARSE, { text: 'half sen' })).body.lines[0];
    expect(l.errors.map((e: any) => [e.code, e.position])).toEqual([
      ['BUY_ALONE_NOT_WHOLE_SEN', null],
      ['PRICE_NOT_POSITIVE_INTEGER', 1],
    ]);
  });

  it('checks a line without a buy-alone price against the product price', async () => {
    fake.priceListFixtures['no single price'] = {
      lines: [draft({ productId: CM, tiers: [{ minQuantity: 20, unitPriceSen: 17000 }] })],
      ignoredText: [],
    };
    const l = (await (await app.as('farid')).post(PARSE, { text: 'no single price' })).body
      .lines[0];
    expect(l.errors.map((e: any) => e.code)).toEqual(['PRICE_NOT_BELOW_BUY_ALONE']);
  });

  it('reads a photo without storing it', async () => {
    fake.priceListFixtures[IMAGE_MARKER] = DRY_GOODS_RESULT;
    const res = await (
      await app.as('farid')
    ).post(PARSE, { imageBase64: JPEG.toString('base64'), mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.lines.find((l: any) => l.productId === CM).tiers).toEqual(NEW_CM_TIERS);
    expect(fake.received).toEqual([IMAGE_MARKER]);
    const run = await app.prisma.aiSuggestionRun.findUniqueOrThrow({
      where: { id: res.body.suggestionRunId },
    });
    expect(run.redactedInput).toBe(IMAGE_MARKER);
  });

  it('refuses a non-image or oversized photo before calling the AI', async () => {
    const farid = await app.as('farid');
    const pdf = await farid.post(PARSE, {
      imageBase64: Buffer.from('%PDF-1.7 fake').toString('base64'),
      mimeType: 'application/pdf',
    });
    expect(pdf).toMatchObject({ status: 422, body: { code: 'UNSUPPORTED_TYPE' } });
    const disguised = await farid.post(PARSE, {
      imageBase64: Buffer.from('%PDF-1.7 fake').toString('base64'),
      mimeType: 'image/png',
    });
    expect(disguised).toMatchObject({ status: 422, body: { code: 'UNSUPPORTED_TYPE' } });
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const tooLarge = await farid.post(PARSE, {
      imageBase64: big.toString('base64'),
      mimeType: 'image/jpeg',
    });
    expect(tooLarge).toMatchObject({ status: 422, body: { code: 'TOO_LARGE' } });
    expect(fake.received).toEqual([]);
    expect(
      await app.prisma.rateLimitHit.count({ where: { bucket: `price-list:${SUP_DRY}` } }),
    ).toBe(0);
  });

  it('asks for a price list when there is neither text nor a photo', async () => {
    const farid = await app.as('farid');
    expect((await farid.post(PARSE, {})).status).toBe(400);
    expect((await farid.post(PARSE, { text: '   ' })).status).toBe(400);
    expect((await farid.post(PARSE, { imageBase64: JPEG.toString('base64') })).status).toBe(400);
    expect(fake.received).toEqual([]);
  });

  it('limits imports to 10 an hour per supplier', async () => {
    const farid = await app.as('farid');
    for (let i = 0; i < 10; i++) {
      expect((await farid.post(PARSE, { text: `list ${i}` })).status).toBe(200);
    }
    const res = await farid.post(PARSE, { text: 'list 11' });
    expect(res).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } });
    expect(
      (
        await (
          await app.as('lim')
        ).post(`/api/suppliers/${seedId('supplier', 'SUP_EGG')}/price-list/parse`, { text: 'eggs' })
      ).status,
    ).toBe(200);
  });

  it('says the AI is unavailable and keeps a failed run', async () => {
    fake.failWith = new AiUnavailableError('down');
    const res = await (await app.as('farid')).post(PARSE, { text: 'anything' });
    expect(res).toMatchObject({ status: 503, body: { code: 'AI_UNAVAILABLE' } });
    const run = await app.prisma.aiSuggestionRun.findFirstOrThrow({
      where: { kind: 'price_list' },
    });
    expect(run).toMatchObject({ status: 'failed', supplierId: SUP_DRY, shopId: null });
  });

  it('is for the supplier itself only', async () => {
    expect((await (await app.as('lim')).post(PARSE, { text: 'x' })).status).toBe(404);
    expect((await (await app.as('ahSeng')).post(PARSE, { text: 'x' })).status).toBe(403);
    expect((await app.anonymous().post(PARSE, { text: 'x' })).status).toBe(401);
    expect(fake.received).toEqual([]);
  });
});

describe('confirming a price list', () => {
  it('refuses a run that was already confirmed', async () => {
    const { farid, view } = await parseDryGoods();
    const body = {
      suggestionRunId: view.suggestionRunId,
      lines: [{ productId: CM, patch: { tiers: NEW_CM_TIERS } }],
    };
    expect((await farid.post(CONFIRM, body)).status).toBe(200);
    const again = await farid.post(CONFIRM, body);
    expect(again).toMatchObject({ status: 409, body: { code: 'SUGGESTION_ALREADY_CONFIRMED' } });
  });

  it("refuses another supplier's run and a run that is not a price list", async () => {
    const { view } = await parseDryGoods();
    const lim = await app.as('lim');
    const SUP_EGG = seedId('supplier', 'SUP_EGG');
    const other = await lim.post(`/api/suppliers/${SUP_EGG}/price-list/confirm`, {
      suggestionRunId: view.suggestionRunId,
      lines: [{ productId: EGG_A, patch: { buyAlonePriceSen: 1400 } }],
    });
    expect(other.status).toBe(404);

    const usual = await (
      await app.as('ahSeng')
    ).post(`/api/shops/${seedId('shop', 'KEDAI_KOPI')}/usual-list/parse`, {
      text: SAMPLE_ORDER_TEXT,
    });
    const wrongKind = await (
      await app.as('farid')
    ).post(CONFIRM, {
      suggestionRunId: usual.body.suggestionRunId,
      lines: [{ productId: CM, patch: { tiers: NEW_CM_TIERS } }],
    });
    expect(wrongKind.status).toBe(404);
    expect(await tiersOf(CM)).toEqual(CM_TIERS_SNAPSHOT);
  });

  it('refuses a run that failed as if it did not exist', async () => {
    fake.failWith = new AiUnavailableError('down');
    const farid = await app.as('farid');
    expect((await farid.post(PARSE, { text: 'anything' })).status).toBe(503);
    const failed = await app.prisma.aiSuggestionRun.findFirstOrThrow({
      where: { kind: 'price_list', status: 'failed' },
    });
    const r = await farid.post(CONFIRM, {
      suggestionRunId: failed.id,
      lines: [{ productId: CM, patch: { tiers: NEW_CM_TIERS } }],
    });
    expect(r).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
    expect(await tiersOf(CM)).toEqual(CM_TIERS_SNAPSHOT);
  });

  it("refuses a line for another supplier's product and applies nothing", async () => {
    const { farid, view } = await parseDryGoods();
    const r = await farid.post(CONFIRM, {
      suggestionRunId: view.suggestionRunId,
      lines: [
        { productId: CM, patch: { tiers: NEW_CM_TIERS } },
        { productId: EGG_A, patch: { buyAlonePriceSen: 1400 } },
      ],
    });
    expect(r).toMatchObject({ status: 404, body: { details: { lineIndex: 1 } } });
    expect(await tiersOf(CM)).toEqual(CM_TIERS_SNAPSHOT);
    expect(
      (await app.prisma.product.findUniqueOrThrow({ where: { id: EGG_A } })).buyAlonePriceSen,
    ).toBe(1320);
  });

  it('refuses the same product twice', async () => {
    const { farid, view } = await parseDryGoods();
    const r = await farid.post(CONFIRM, {
      suggestionRunId: view.suggestionRunId,
      lines: [
        { productId: CM, patch: { tiers: NEW_CM_TIERS } },
        { productId: CM, patch: { buyAlonePriceSen: 17000 } },
      ],
    });
    expect(r.status).toBe(400);
    expect(await tiersOf(CM)).toEqual(CM_TIERS_SNAPSHOT);
  });
});

describe('AI run ownership', () => {
  it('keeps every run tied to exactly one shop or one supplier', async () => {
    const base = {
      kind: 'price_list' as const,
      status: 'succeeded' as const,
      model: 'm',
      redactedInput: 'x',
      suggestions: {},
      latencyMs: 1,
    };
    await expect(app.prisma.aiSuggestionRun.create({ data: base })).rejects.toThrow(
      /ai_suggestion_runs_one_owner/,
    );
    await expect(
      app.prisma.aiSuggestionRun.create({
        data: { ...base, supplierId: SUP_DRY, shopId: seedId('shop', 'KEDAI_KOPI') },
      }),
    ).rejects.toThrow(/ai_suggestion_runs_one_owner/);
  });
});
