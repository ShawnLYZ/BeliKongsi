/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { SAMPLE_ORDER_TEXT } from '../../prisma/seed/sample-order';
import { createTestApp, type TestApp } from './helpers/app';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const LIST = `/api/shops/${KEDAI}/usual-list`;
const p = (k: string) => seedId('product', k);
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp();
});
afterEach(async () => {
  await app.close();
});

const saveCm = async (over: Record<string, unknown> = {}) =>
  (await app.as('ahSeng')).put(LIST, {
    items: [{ productId: p('CM'), quantity: 6, usualPriceSen: 16500, ...over }],
  });

const saveWithRun = async (suggestionRunId: string) =>
  (await app.as('ahSeng')).put(LIST, {
    suggestionRunId,
    items: [{ productId: p('CM'), quantity: 6, usualPriceSen: 16500 }],
  });

describe('the usual list', () => {
  it('uses the usual price as the default price limit (story 20)', async () => {
    const res = await saveCm();
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      quantity: 6,
      usualPriceSen: 16500,
      priceLimitSen: 16500,
    });
  });

  it('keeps a removed limit as no limit (story 21)', async () => {
    const res = await saveCm({ priceLimitSen: null });
    expect(res.body.items[0]).toMatchObject({ usualPriceSen: 16500, priceLimitSen: null });
    const got = await (await app.as('ahSeng')).get(LIST);
    expect(got.body.list.items[0].priceLimitSen).toBeNull();
  });

  it.each([0, -5])('rejects a price limit of %s', async (limit) => {
    const res = await saveCm({ priceLimitSen: limit });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PRICE_LIMIT_NOT_POSITIVE');
    expect(await app.prisma.usualList.count({ where: { shopId: KEDAI } })).toBe(0);
  });

  it('refuses a line without a quantity', async () => {
    const res = await (
      await app.as('ahSeng')
    ).put(LIST, {
      items: [{ productId: p('CM'), usualPriceSen: 16500 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
    const empty = await saveCm({ quantity: null });
    expect(empty.status).toBe(400);
  });

  it.each([0, 1000, 2.5, -1])('refuses quantity %s', async (quantity) => {
    const res = await saveCm({ quantity });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });

  it('refuses a duplicate product, an unknown product and a bad usual price', async () => {
    const c = await app.as('ahSeng');
    const dup = await c.put(LIST, {
      items: [
        { productId: p('CM'), quantity: 1, usualPriceSen: null },
        { productId: p('CM'), quantity: 2, usualPriceSen: null },
      ],
    });
    expect(dup.status).toBe(400);
    const unknown = await c.put(LIST, {
      items: [{ productId: seedId('product', 'NOPE'), quantity: 1, usualPriceSen: null }],
    });
    expect(unknown.status).toBe(400);
    expect((await saveCm({ usualPriceSen: 0 })).status).toBe(400);
    expect((await saveCm({ usualPriceSen: 12.5 })).status).toBe(400);
  });

  it('answers { list: null } before the first save', async () => {
    const res = await (await app.as('ahSeng')).get(LIST);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ list: null });
  });

  it('records what the owner changed from the AI suggestion (story 25)', async () => {
    const c = await app.as('ahSeng');
    const parsed = await c.post(`${LIST}/parse`, { text: SAMPLE_ORDER_TEXT });
    const runId = parsed.body.suggestionRunId;
    const save = (id: string) =>
      c.put(LIST, {
        suggestionRunId: id,
        items: [
          { productId: p('EGG_A'), quantity: 10, usualPriceSen: 1200 },
          { productId: p('OIL'), quantity: 3, usualPriceSen: 9000 },
          { productId: p('CM'), quantity: 6, usualPriceSen: 16500 },
          { productId: p('COFFEE'), quantity: 1, usualPriceSen: 25800 },
          { productId: p('EM'), quantity: 1, usualPriceSen: 15000 },
        ],
      });
    const res = await save(runId);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);

    const e = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'usual_list.confirmed' },
    });
    expect(e).toMatchObject({
      actorType: 'person',
      after: { changeSummary: { acceptedUnchanged: 3, changed: 1, added: 1, removed: 1 } },
    });
    const run = await app.prisma.aiSuggestionRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.confirmedAt).not.toBeNull();
    expect(run.changeSummary).toEqual({ acceptedUnchanged: 3, changed: 1, added: 1, removed: 1 });
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'usual_list.item_updated' } }),
    ).toBe(0);

    const again = await save(runId);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SUGGESTION_ALREADY_CONFIRMED');
  });

  it('refuses a suggestion from another shop or that failed', async () => {
    const other = await (
      await app.as('siti')
    ).post(`/api/shops/${GERAI}/usual-list/parse`, {
      text: SAMPLE_ORDER_TEXT,
    });
    const res = await saveWithRun(other.body.suggestionRunId);
    expect(res.status).toBe(400);
    const missing = await saveWithRun(seedId('run', 'missing'));
    expect(missing.status).toBe(400);
    const failed = await app.prisma.aiSuggestionRun.create({
      data: {
        shopId: KEDAI,
        kind: 'usual_list_text',
        status: 'failed',
        model: 'm',
        redactedInput: 'x',
        suggestions: { error: 'down' },
        latencyMs: 1,
      },
    });
    expect((await saveWithRun(failed.id)).status).toBe(400);
  });

  it('logs the first save as a confirmation without a suggestion', async () => {
    await saveCm();
    const e = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'usual_list.confirmed' },
    });
    expect(e.after).toMatchObject({
      changeSummary: { acceptedUnchanged: 0, changed: 0, added: 1, removed: 0 },
    });
  });

  it('logs later edits item by item (story 22)', async () => {
    const c = await app.as('ahSeng');
    await c.put(LIST, {
      items: [
        { productId: p('CM'), quantity: 6, usualPriceSen: 16500 },
        { productId: p('OIL'), quantity: 2, usualPriceSen: 9000 },
        { productId: p('COFFEE'), quantity: 1, usualPriceSen: 25800 },
      ],
    });
    const before = await app.prisma.usualListItem.findMany({
      where: { usualList: { shopId: KEDAI } },
    });
    const res = await c.put(LIST, {
      items: [
        { productId: p('CM'), quantity: 8, usualPriceSen: 16500 },
        { productId: p('OIL'), quantity: 2, usualPriceSen: 9000 },
        { productId: p('EM'), quantity: 1, usualPriceSen: null },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.productId).sort()).toEqual(
      [p('CM'), p('OIL'), p('EM')].sort(),
    );

    const logs = await app.prisma.activityLogEntry.findMany({
      where: { action: 'usual_list.item_updated' },
      orderBy: { seq: 'asc' },
    });
    expect(logs).toHaveLength(3);
    const cmItem = before.find((i) => i.productId === p('CM'))!;
    expect(logs[0]).toMatchObject({
      actorType: 'person',
      subjectId: cmItem.id,
      before: { quantity: 6 },
      after: { quantity: 8 },
    });
    expect(logs[1]).toMatchObject({
      before: null,
      after: { productId: p('EM'), quantity: 1, usualPriceSen: null, priceLimitSen: null },
    });
    expect(logs[2]).toMatchObject({
      after: null,
      before: { productId: p('COFFEE'), quantity: 1 },
    });
    // The item that stayed keeps its id; saving the same list again logs nothing.
    expect(
      (await app.prisma.usualListItem.findUniqueOrThrow({ where: { id: cmItem.id } })).quantity,
    ).toBe(8);
    await c.put(LIST, { items: res.body.items });
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'usual_list.item_updated' } }),
    ).toBe(3);
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'usual_list.confirmed' } }),
    ).toBe(1);
  });

  it('logs price and limit edits as changed fields only', async () => {
    const c = await app.as('ahSeng');
    await saveCm();
    await saveCm({ usualPriceSen: 17000, priceLimitSen: 16500 });
    const e = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'usual_list.item_updated' },
    });
    expect(e).toMatchObject({ before: { usualPriceSen: 16500 }, after: { usualPriceSen: 17000 } });
    expect(Object.keys(e.after as object)).toEqual(['usualPriceSen']);
    void c;
  });

  it('keeps the usual list from staff and other shops', async () => {
    expect((await (await app.as('rahim')).get(LIST)).status).toBe(403);
    expect((await (await app.as('rahim')).put(LIST, { items: [] })).status).toBe(403);
    expect((await (await app.as('siti')).get(LIST)).status).toBe(404);
    expect((await app.anonymous().get(LIST)).status).toBe(401);
  });

  it('edits a seeded list', async () => {
    const res = await (await app.as('siti')).get(`/api/shops/${GERAI}/usual-list`);
    expect(res.body.list.items).toHaveLength(4);
    expect(res.body.list.items.find((i: any) => i.productId === p('CM'))).toMatchObject({
      quantity: 4,
      usualPriceSen: 16800,
    });
  });

  it('refuses a deactivated product but keeps one already on the list', async () => {
    const c = await app.as('ahSeng');
    await app.prisma.product.update({ where: { id: p('EM') }, data: { active: false } });
    const added = await c.put(LIST, {
      items: [{ productId: p('EM'), quantity: 1, usualPriceSen: null }],
    });
    expect(added.status).toBe(400);
    expect(added.body.code).toBe('INVALID_INPUT');
    expect(await app.prisma.usualList.count({ where: { shopId: KEDAI } })).toBe(0);

    await app.prisma.product.update({ where: { id: p('EM') }, data: { active: true } });
    const first = await c.put(LIST, {
      items: [{ productId: p('EM'), quantity: 1, usualPriceSen: null }],
    });
    expect(first.status).toBe(200);
    await app.prisma.product.update({ where: { id: p('EM') }, data: { active: false } });
    const again = await c.put(LIST, {
      items: [{ productId: p('EM'), quantity: 2, usualPriceSen: null }],
    });
    expect(again.status).toBe(200);
    expect(again.body.items[0].quantity).toBe(2);
  });
});
