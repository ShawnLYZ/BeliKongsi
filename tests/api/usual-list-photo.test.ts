/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import type { FakeOrderReader } from '@/server/adapters/ai/fake';
import { describePriceListInput } from '@/server/adapters/ai/price-list';
import type { ReadResult } from '@/server/adapters/ai/types';
import { createTestApp, type TestApp } from './helpers/app';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const URL = `/api/shops/${KEDAI}/usual-list/parse-photo`;
const TEXT_URL = `/api/shops/${KEDAI}/usual-list/parse`;
const CM = seedId('product', 'CM');
const OIL = seedId('product', 'OIL');

// A small JPEG-signed body: the server checks the first bytes, nothing more.
const invoiceFixture = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const b64 = (b: Buffer) => b.toString('base64');
const markerOf = (b: Buffer) =>
  describePriceListInput({
    image: { bytes: new Uint8Array(b), mimeType: 'image/jpeg' },
  });
const readLine = (productId: string, quantity: number) => ({
  sourceText: 'invoice line',
  productId,
  quantity,
  unitAsWritten: 'ctn',
  confidence: 0.95,
  alternatives: [],
  note: null,
});
const invoiceReading: ReadResult = {
  lines: [readLine(CM, 6), readLine(OIL, 2)],
  ignoredText: ['Thank you'],
};
const expectedFromFixture = [
  [CM, 6],
  [OIL, 2],
];

let app: TestApp;
let fakeAi: FakeOrderReader;
beforeEach(async () => {
  app = await createTestApp();
  fakeAi = app.deps.ai as FakeOrderReader;
  fakeAi.fixtures[markerOf(invoiceFixture)] = invoiceReading;
});
afterEach(async () => {
  await app.close();
});

const files = () => readdirSync(app.deps.env.LOCAL_STORAGE_DIR, { recursive: true }).sort();

describe('building the usual list from an invoice photo', () => {
  it('reads an invoice photo with the same review as pasted text (story 26)', async () => {
    const ah = await app.as('ahSeng');
    const res = await ah.post(URL, { imageBase64: b64(invoiceFixture), mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ai');
    expect(res.body.lines.map((l: any) => [l.product?.id ?? null, l.quantity])).toEqual(
      expectedFromFixture,
    );
    expect(res.body.lines.every((l: any) => l.samplePriceSen === undefined)).toBe(true);
    expect(res.body.ignoredText).toEqual(['Thank you']);
  });

  it('never stores the photo', async () => {
    const ah = await app.as('ahSeng');
    const filesBefore = files();
    const res = await ah.post(URL, { imageBase64: b64(invoiceFixture), mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    const run = await app.prisma.aiSuggestionRun.findFirstOrThrow({
      where: { kind: 'usual_list_photo' },
    });
    expect(run.redactedInput).toBe('[photo, not stored]');
    expect(JSON.stringify(run)).not.toContain(b64(invoiceFixture).slice(0, 20));
    const log = JSON.stringify(await app.prisma.activityLogEntry.findMany(), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(log).not.toContain(b64(invoiceFixture).slice(0, 20));
    expect(files()).toEqual(filesBefore);
  });

  it('removes phone numbers and emails the photo contained before anything is stored', async () => {
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xee, 4, 4, 4, 4]);
    fakeAi.fixtures[markerOf(photo)] = {
      lines: [
        {
          ...readLine(CM, 6),
          sourceText: 'Ah Seng 012-345 6789 susu 6',
          note: 'call 013-999 8888',
        },
      ],
      ignoredText: ['Tel 012-345 6789', 'ahseng@example.com'],
    };
    const res = await (
      await app.as('ahSeng')
    ).post(URL, { imageBase64: b64(photo), mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    const run = await app.prisma.aiSuggestionRun.findFirstOrThrow({
      where: { kind: 'usual_list_photo' },
    });
    for (const text of [JSON.stringify(run.suggestions), JSON.stringify(res.body)]) {
      expect(text).not.toMatch(/345 6789|999 8888|ahseng@example/);
      expect(text).toContain('[phone removed]');
    }
  });

  it('answers a photo with no items with an empty review', async () => {
    const ah = await app.as('ahSeng');
    const other = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 9, 9, 9]);
    const res = await ah.post(URL, { imageBase64: b64(other), mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual([]);
  });

  it('says the AI is unavailable when the reader is down', async () => {
    const { AiUnavailableError } = await import('@/server/adapters/ai/types');
    fakeAi.failWith = new AiUnavailableError('down');
    const res = await (
      await app.as('ahSeng')
    ).post(URL, { imageBase64: b64(invoiceFixture), mimeType: 'image/jpeg' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
  });

  it('records what the owner changed when a photo suggestion is saved', async () => {
    const ah = await app.as('ahSeng');
    const parsed = await ah.post(URL, { imageBase64: b64(invoiceFixture), mimeType: 'image/jpeg' });
    const saved = await ah.put(`/api/shops/${KEDAI}/usual-list`, {
      suggestionRunId: parsed.body.suggestionRunId,
      items: [
        { productId: CM, quantity: 6, usualPriceSen: 16500 },
        { productId: OIL, quantity: 3, usualPriceSen: 9000 },
      ],
    });
    expect(saved.status).toBe(200);
    const run = await app.prisma.aiSuggestionRun.findUniqueOrThrow({
      where: { id: parsed.body.suggestionRunId },
    });
    expect(run.kind).toBe('usual_list_photo');
    expect(run.confirmedAt).not.toBeNull();
    expect(run.changeSummary).toEqual({ acceptedUnchanged: 1, changed: 1, added: 0, removed: 0 });
  });

  it('is for the shop owner only', async () => {
    const res = await (
      await app.as('nadia')
    ).post(URL, { imageBase64: b64(invoiceFixture), mimeType: 'image/jpeg' });
    expect(res.status).toBe(403);
  });

  it.each([
    ['image/heic', 1000],
    ['application/pdf', 1000],
    // 6 MB (not 6 MiB): its base64 must still fit the route's 8 MiB body limit, so the size check answers.
    ['image/jpeg', 6_000_000],
  ])('refuses %s of %s bytes', async (mimeType, size) => {
    const res = await (
      await app.as('ahSeng')
    ).post(URL, { imageBase64: b64(Buffer.alloc(size)), mimeType });
    expect(res.status).toBe(422);
    expect(fakeAi.received).toEqual([]);
    expect(await app.prisma.rateLimitHit.count({ where: { bucket: `ai-parse:${KEDAI}` } })).toBe(0);
  });

  it('shares the 10-an-hour limit with text parsing', async () => {
    const ah = await app.as('ahSeng');
    for (let i = 0; i < 9; i++) {
      expect((await ah.post(TEXT_URL, { text: `order ${i}` })).status).toBe(200);
    }
    const photo = { imageBase64: b64(invoiceFixture), mimeType: 'image/jpeg' };
    expect((await ah.post(URL, photo)).status).toBe(200);
    const eleventh = await ah.post(URL, photo);
    expect(eleventh.status).toBe(429);
    expect((await ah.post(TEXT_URL, { text: 'one more' })).status).toBe(429);
  });
});
