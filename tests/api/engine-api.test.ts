/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeRound, unitAmounts } from '@/server/engine';
import { setDepsForTests } from '@/server/platform/deps';
import { CM_TIERS, EGG_B_TIERS, exampleWeekCm } from '../engine/fixtures';
import { callRoute } from './helpers/route';

const QUOTE = '/api/engine/v1/quote';
const CLOSE = '/api/engine/v1/close-round';
const SHORTFALL = '/api/engine/v1/allocate-shortfall';

afterEach(() => {
  setDepsForTests(null);
  vi.restoreAllMocks();
});

function eggsWithReferences() {
  const start = unitAmounts(EGG_B_TIERS[0]!.unitPriceSen, 200, 40).allInSen;
  const background = [20, 18, 15, 14, 12, 11, 10, 8, 7, 5].map((quantity, i) => ({
    reference: `egg${i + 1}`,
    quantity,
    joinedAt: `2026-10-31T0${i}:00:00Z`,
    unitShippingSen: 40,
    priceLimitSen: null,
    paidSen: start * quantity,
  }));
  return [
    ...background,
    {
      reference: 'kafe',
      quantity: 10,
      joinedAt: '2026-11-01T22:03:00Z',
      unitShippingSen: 40,
      priceLimitSen: 1220,
      paidSen: 12330,
    },
  ];
}

function shortfallExample() {
  const participants = exampleWeekCm();
  const result = closeRound({ tiers: CM_TIERS, feeBps: 200, participants });
  const kept = result.participants.flatMap((r) => {
    if (r.outcome !== 'kept' || r.final === null) return [];
    const p = participants.find((x) => x.id === r.id)!;
    return [{ reference: r.id, quantity: p.quantity, joinedAt: p.joinedAt, final: r.final }];
  });
  return { kept, goodUnitsReceived: 100, finalGoodsPriceSen: 14600 };
}

const quoteBody = {
  tiers: CM_TIERS,
  feeBps: 200,
  unitShippingSen: 293,
  quantity: 6,
  currentRoundTotal: 99,
  unitName: 'carton',
};

const paths = (res: { body: any }): string[] => res.body.details.fields.map((f: any) => f.path);

describe('POST /api/engine/v1/quote', () => {
  it('quotes the condensed milk example', async () => {
    const res = await callRoute('POST', QUOTE, { body: quoteBody });
    expect(res.status).toBe(200);
    expect(res.body.withYou.amounts.allInSen).toBe(15185);
  });

  it('defaults the unit name to "unit"', async () => {
    const rest: Partial<typeof quoteBody> = { ...quoteBody };
    delete rest.unitName;
    const res = await callRoute('POST', QUOTE, { body: rest });
    expect(res.status).toBe(200);
    expect(res.body.explanation.join(' ')).toContain('a unit now');
  });

  it('lists every bad field with a 422', async () => {
    const res = await callRoute('POST', QUOTE, {
      body: {
        tiers: [
          { minQuantity: 20, unitPriceSen: 200 },
          { minQuantity: '20', unitPriceSen: 100 },
        ],
        feeBps: 200,
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_ENGINE_INPUT');
    expect(res.body.message).toBe('Some fields are not valid.');
    expect(paths(res)).toEqual(
      expect.arrayContaining([
        'tiers[1].minQuantity',
        'unitShippingSen',
        'quantity',
        'currentRoundTotal',
      ]),
    );
  });

  it('reports engine rule violations as a 422 with the engine paths', async () => {
    const res = await callRoute('POST', QUOTE, {
      body: {
        ...quoteBody,
        tiers: [
          { minQuantity: 20, unitPriceSen: 100 },
          { minQuantity: 20, unitPriceSen: 100 },
        ],
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_ENGINE_INPUT');
    expect(paths(res)).toContain('tiers[1].minQuantity');
  });

  it('answers 422 for a null tier instead of crashing', async () => {
    const res = await callRoute('POST', QUOTE, { body: { ...quoteBody, tiers: [null] } });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('tiers[0]');
  });

  it('answers 422 for a unit price too large to stay exact', async () => {
    const tiers = [{ minQuantity: 20, unitPriceSen: Number.MAX_SAFE_INTEGER }];
    const res = await callRoute('POST', QUOTE, { body: { ...quoteBody, tiers } });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('tiers[0].unitPriceSen');
  });

  it('answers 422 with an empty path when the body is not an object', async () => {
    const res = await callRoute('POST', QUOTE, { body: [] });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('');
  });

  it('answers 400 for malformed JSON', async () => {
    const res = await callRoute('POST', QUOTE, { body: '{not json' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: 'INVALID_INPUT',
      message: 'The request body must be valid JSON.',
    });
  });
});

describe('POST /api/engine/v1/close-round', () => {
  it('closes a round and answers with references', async () => {
    const res = await callRoute('POST', CLOSE, {
      body: { tiers: EGG_B_TIERS, feeBps: 200, participants: eggsWithReferences() },
    });
    expect(res.status).toBe(200);
    expect(res.body.participants.find((p: any) => p.reference === 'kafe')).toMatchObject({
      outcome: 'dropped_price_limit',
      refundSen: 12330,
    });
    expect(res.body.participants.some((p: any) => 'id' in p)).toBe(false);
  });

  it('treats the price limit as optional', async () => {
    const participants = exampleWeekCm().map(({ id, ...rest }) => {
      const participant: Record<string, unknown> = { reference: id, ...rest };
      delete participant.priceLimitSen;
      return participant;
    });
    const res = await callRoute('POST', CLOSE, {
      body: { tiers: CM_TIERS, feeBps: 200, participants },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('formed');
  });

  it('answers 422 for a quantity above the cap', async () => {
    const participants = eggsWithReferences();
    participants[0]!.quantity = 100_001;
    const res = await callRoute('POST', CLOSE, {
      body: { tiers: EGG_B_TIERS, feeBps: 200, participants },
    });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('participants[0].quantity');
  });

  it('answers 422 for a duplicate reference, naming the reference field', async () => {
    const participants = eggsWithReferences();
    participants[1]!.reference = participants[0]!.reference;
    const res = await callRoute('POST', CLOSE, {
      body: { tiers: EGG_B_TIERS, feeBps: 200, participants },
    });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('participants[1].reference');
  });
});

describe('request bodies are bounded and strict', () => {
  const closeBody = (participants: any[], tiers: any[] = EGG_B_TIERS) => ({
    tiers,
    feeBps: 200,
    participants,
  });

  it('answers 422 for a join time without an offset', async () => {
    const participants = eggsWithReferences();
    participants[0]!.joinedAt = '2026-11-01T10:00:00';
    const res = await callRoute('POST', CLOSE, { body: closeBody(participants) });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('participants[0].joinedAt');
  });

  it('accepts a join time with an offset', async () => {
    const participants = eggsWithReferences();
    participants[0]!.joinedAt = '2026-11-01T10:00:00+08:00';
    const res = await callRoute('POST', CLOSE, { body: closeBody(participants) });
    expect(res.status).toBe(200);
  });

  it('answers 422 for more than 5 tiers', async () => {
    const tiers = Array.from({ length: 6 }, (_, i) => ({
      minQuantity: i * 10 + 1,
      unitPriceSen: 1000 - i,
    }));
    const res = await callRoute('POST', CLOSE, { body: closeBody(eggsWithReferences(), tiers) });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('tiers');
  });

  it('answers 422 for a reference longer than 200 characters', async () => {
    const participants = eggsWithReferences();
    participants[0]!.reference = 'r'.repeat(201);
    const res = await callRoute('POST', CLOSE, { body: closeBody(participants) });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('participants[0].reference');
  });

  it('answers 422 for an unknown key, at the key path', async () => {
    const participants: any[] = eggsWithReferences();
    participants[0] = { ...participants[0], priceLimitsen: 1 };
    const res = await callRoute('POST', CLOSE, { body: closeBody(participants) });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('participants[0].priceLimitsen');
  });

  it('names kept[i].reference for a duplicate in allocate-shortfall', async () => {
    const body = shortfallExample();
    body.kept[1]!.reference = body.kept[0]!.reference;
    const res = await callRoute('POST', SHORTFALL, { body });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('kept[1].reference');
  });
});

describe('POST /api/engine/v1/allocate-shortfall', () => {
  it('works without a database', async () => {
    setDepsForTests(null);
    const res = await callRoute('POST', SHORTFALL, { body: shortfallExample() });
    expect(res.status).toBe(200);
    expect(res.body.allocations.at(-1)).toMatchObject({
      reference: 'kedai',
      missing: 5,
      refundSen: 75925,
    });
    expect(res.body.allocations.some((a: any) => 'id' in a)).toBe(false);
  });

  it('answers 422 for a kept entry without a final object', async () => {
    const body = shortfallExample();
    const kept = body.kept.map((k, i) => (i === 2 ? { ...k, final: undefined } : k));
    const res = await callRoute('POST', SHORTFALL, { body: { ...body, kept } });
    expect(res.status).toBe(422);
    expect(paths(res)).toContain('kept[2].final');
  });

  it('answers 422 for a final amount that does not add up', async () => {
    const body = shortfallExample();
    body.kept[2]!.final = { ...body.kept[2]!.final, allInSen: 1 };
    const res = await callRoute('POST', SHORTFALL, { body });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_ENGINE_INPUT');
    expect(paths(res)).toContain('kept[2].final.allInSen');
  });
});

describe('X-Orbyte-App-Id', () => {
  it('logs the app id with control characters stripped, then cut to 64 characters', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await callRoute('POST', CLOSE, {
      body: { tiers: EGG_B_TIERS, feeBps: 200, participants: eggsWithReferences() },
      headers: { 'X-Orbyte-App-Id': `a\tb${'y'.repeat(100)}` },
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(`[engine-api] app=ab${'y'.repeat(62)} op=close-round`);
  });

  it('logs the operation name for a quote', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await callRoute('POST', QUOTE, { body: quoteBody, headers: { 'X-Orbyte-App-Id': 'shop-1' } });
    expect(info).toHaveBeenCalledWith('[engine-api] app=shop-1 op=quote');
  });

  it('logs nothing when the header is absent', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await callRoute('POST', SHORTFALL, { body: shortfallExample() });
    expect(info).not.toHaveBeenCalled();
  });
});
