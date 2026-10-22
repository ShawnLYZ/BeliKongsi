/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { SAMPLE_ORDER_TEXT } from '../../prisma/seed/sample-order';
import { AiUnavailableError } from '@/server/adapters/ai/gemini';
import type { FakeOrderReader } from '@/server/adapters/ai/fake';
import type { ReadLine, ReadResult } from '@/server/adapters/ai/types';
import { createTestApp, type TestApp } from './helpers/app';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const URL = `/api/shops/${KEDAI}/usual-list/parse`;
let app: TestApp;
let fakeAi: FakeOrderReader;
beforeEach(async () => {
  app = await createTestApp();
  fakeAi = app.deps.ai as FakeOrderReader;
});
afterEach(async () => {
  await app.close();
});

const line = (over: Partial<ReadLine> = {}): ReadLine => ({
  sourceText: 'susu 2',
  productId: seedId('product', 'CM'),
  quantity: 2,
  unitAsWritten: 'ctn',
  confidence: 0.95,
  alternatives: [],
  note: null,
  ...over,
});
const inject = (text: string, result: ReadResult) => {
  fakeAi.fixtures[text] = result;
};
const parseOne = async (over: Partial<ReadLine>) => {
  inject('one line', { lines: [line(over)], ignoredText: [] });
  return (await (await app.as('ahSeng')).post(URL, { text: 'one line' })).body.lines[0];
};

describe('parsing a pasted order', () => {
  it('reads the sample order after removing the phone number (stories 11–14, 18, 154)', async () => {
    const res = await (await app.as('ahSeng')).post(URL, { text: SAMPLE_ORDER_TEXT });
    expect(res.status).toBe(200);
    expect(res.body.lines.map((l: any) => [l.product?.id ?? null, l.quantity, l.status])).toEqual([
      [seedId('product', 'CM'), 6, 'ok'],
      [seedId('product', 'OIL'), 2, 'ok'],
      [seedId('product', 'EGG_A'), 10, 'check'],
      [seedId('product', 'COFFEE'), 1, 'ok'],
      [seedId('product', 'CUPS'), 2, 'ok'],
    ]);
    expect(res.body.lines[2].alternatives.map((a: any) => a.id)).toEqual([
      seedId('product', 'EGG_B'),
    ]);
    expect(res.body.lines[0].samplePriceSen).toBe(16500);
    expect(res.body.ignoredText).toHaveLength(2);
    expect(res.body.source).toBe('ai');
    expect(fakeAi.received.at(-1)).toContain('[phone removed]');
    expect(fakeAi.received.at(-1)).not.toContain('012-345 6789');
  });

  it('offers no sample prices for other text', async () => {
    const l = await parseOne({});
    expect(l.samplePriceSen).toBeUndefined();
  });

  it('turns an invented product id into "not found" (story 16)', async () => {
    const l = await parseOne({
      productId: 'not-a-real-id',
      alternatives: ['also-fake', seedId('product', 'EGG_B')],
    });
    expect(l).toMatchObject({ product: null, status: 'not_found' });
    expect(l.alternatives.map((a: any) => a.id)).toEqual([seedId('product', 'EGG_B')]);
  });

  it.each([0, -2, 2.5, 1000])('turns quantity %s into an empty quantity to check', async (q) => {
    expect(await parseOne({ quantity: q })).toMatchObject({ quantity: null, status: 'check' });
  });

  it('marks a line with no quantity as "check"', async () => {
    expect(await parseOne({ quantity: null, sourceText: 'telur papan' })).toMatchObject({
      quantity: null,
      status: 'check',
    });
  });

  it('flags low confidence and caps alternatives at three valid ones', async () => {
    expect(await parseOne({ confidence: 0.79 })).toMatchObject({ status: 'check' });
    const ids = ['OIL', 'EGG_A', 'EGG_B', 'COFFEE'].map((k) => seedId('product', k));
    const l = await parseOne({ alternatives: ids });
    expect(l.status).toBe('check');
    expect(l.alternatives).toHaveLength(3);
  });

  it('answers a greeting-only message with no lines', async () => {
    inject('Selamat pagi boss', { lines: [], ignoredText: ['Selamat pagi boss'] });
    const res = await (await app.as('ahSeng')).post(URL, { text: 'Selamat pagi boss' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lines: [], ignoredText: ['Selamat pagi boss'] });
  });

  it('saves nothing to the usual list (story 17)', async () => {
    const before = await app.prisma.usualListItem.count();
    await (await app.as('ahSeng')).post(URL, { text: SAMPLE_ORDER_TEXT });
    expect(await app.prisma.usualListItem.count()).toBe(before);
    const list = await app.prisma.usualList.findUnique({ where: { shopId: KEDAI } });
    const count = list
      ? await app.prisma.usualListItem.count({ where: { usualListId: list.id } })
      : 0;
    expect(count).toBe(0);
  });

  it('stores only the redacted text in the run', async () => {
    const res = await (await app.as('ahSeng')).post(URL, { text: SAMPLE_ORDER_TEXT });
    const run = await app.prisma.aiSuggestionRun.findUniqueOrThrow({
      where: { id: res.body.suggestionRunId },
    });
    expect(run).toMatchObject({ status: 'succeeded', kind: 'usual_list_text', shopId: KEDAI });
    expect(run.redactedInput).toContain('[phone removed]');
    expect(run.redactedInput).not.toContain('345 6789');
  });

  it('logs the AI suggestion with actor AI (story 25)', async () => {
    const res = await (await app.as('ahSeng')).post(URL, { text: SAMPLE_ORDER_TEXT });
    const e = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'usual_list.ai_suggested' },
    });
    expect(e).toMatchObject({
      actorType: 'ai',
      aiMetadata: { lineCount: 5, suggestionRunId: res.body.suggestionRunId },
    });
  });

  it('is for owners of the shop only', async () => {
    expect((await (await app.as('rahim')).post(URL, { text: 'x' })).status).toBe(403);
    expect((await app.anonymous().post(URL, { text: 'x' })).status).toBe(401);
  });

  it('limits parsing to 10 an hour per shop', async () => {
    const c = await app.as('ahSeng');
    for (let i = 0; i < 10; i++) {
      expect((await c.post(URL, { text: `order ${i}` })).status).toBe(200);
    }
    const res = await c.post(URL, { text: 'order 11' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  it('says the AI is unavailable and offers the saved example in demo mode (stories 24, 170)', async () => {
    const c = await app.as('ahSeng');
    fakeAi.failWith = new AiUnavailableError('down');
    const res = await c.post(URL, { text: SAMPLE_ORDER_TEXT });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'AI_UNAVAILABLE',
      details: { canUseSavedExample: true },
    });
    expect(await app.prisma.aiSuggestionRun.count({ where: { status: 'failed' } })).toBe(1);

    const again = await c.post(URL, { text: SAMPLE_ORDER_TEXT, useSavedExample: true });
    expect(again.status).toBe(200);
    expect(again.body.source).toBe('saved_example');
    expect(again.body.lines).toHaveLength(5);
    expect(await app.prisma.aiSuggestionRun.count({ where: { status: 'saved_example' } })).toBe(1);
  });

  it('refuses the saved example outside demo mode', async () => {
    app.deps.env.DEMO_MODE = false;
    const c = await app.as('ahSeng');
    expect((await c.post(URL, { text: 'x', useSavedExample: true })).status).toBe(403);
    fakeAi.failWith = new AiUnavailableError('down');
    const res = await c.post(URL, { text: 'x' });
    expect(res.body.details).toEqual({ canUseSavedExample: false });
  });

  it('refuses more than 2,000 characters or 40 lines before using the AI or the rate limit', async () => {
    const c = await app.as('ahSeng');
    const long = await c.post(URL, { text: 'a'.repeat(2001) });
    expect(long.status).toBe(400);
    expect(long.body.code).toBe('INPUT_TOO_LONG');
    const many = await c.post(URL, { text: Array(41).fill('susu 1').join('\n') });
    expect(many.body.code).toBe('INPUT_TOO_LONG');
    expect((await c.post(URL, { text: Array(40).fill('s').join('\n') })).status).toBe(200);
    expect(fakeAi.received).toHaveLength(1);
    expect(await app.prisma.rateLimitHit.count({ where: { bucket: `ai-parse:${KEDAI}` } })).toBe(1);
  });
});
