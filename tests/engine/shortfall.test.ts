import { describe, expect, it } from 'vitest';
import {
  allocateShortfall,
  closeRound,
  EngineInputError,
  unitAmounts,
  type KeptForAllocation,
} from '@/server/engine';
import { CM_TIERS, exampleWeekCm } from './fixtures';

function keptFromClose(): KeptForAllocation[] {
  const participants = exampleWeekCm();
  const result = closeRound({ tiers: CM_TIERS, feeBps: 200, participants });
  return result.participants.flatMap((r) => {
    if (r.outcome !== 'kept' || r.final === null) return [];
    const input = participants.find((x) => x.id === r.id)!;
    return [{ id: r.id, quantity: input.quantity, joinedAt: input.joinedAt, final: r.final }];
  });
}

const k = (id: string, quantity: number, joinedAt: string): KeptForAllocation => ({
  id,
  quantity,
  joinedAt,
  final: unitAmounts(14600, 200, 293),
});

function fieldsOf(fn: () => unknown): { path: string; message: string }[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineInputError) return error.fields;
    throw error;
  }
  throw new Error('expected EngineInputError');
}

describe('allocateShortfall', () => {
  it('allocates a 5-carton shortfall to the last joiner (PRD §6.13)', () => {
    const r = allocateShortfall({
      kept: keptFromClose(),
      goodUnitsReceived: 100,
      finalGoodsPriceSen: 14600,
    });
    expect(r.allocations.at(-1)).toEqual({
      id: 'kedai',
      allocated: 1,
      missing: 5,
      refundSen: 75925,
    });
    expect(r.allocations.slice(0, -1).every((a) => a.missing === 0)).toBe(true);
    expect(r).toMatchObject({
      orderedQuantity: 105,
      receivedCounted: 100,
      excessFlag: false,
      supplierPayableSen: 1460000,
      feeRevenueSen: 29200,
      logisticsPayableSen: 32958,
      shortfallRefundSen: 75925,
    });
  });

  it('settles the full delivery with no refunds', () => {
    expect(
      allocateShortfall({
        kept: keptFromClose(),
        goodUnitsReceived: 105,
        finalGoodsPriceSen: 14600,
      }),
    ).toMatchObject({ supplierPayableSen: 1533000, shortfallRefundSen: 0 });
  });

  it('caps and flags units above the ordered quantity', () => {
    expect(
      allocateShortfall({
        kept: keptFromClose(),
        goodUnitsReceived: 110,
        finalGoodsPriceSen: 14600,
      }),
    ).toMatchObject({
      receivedCounted: 105,
      excessUnits: 5,
      excessFlag: true,
      supplierPayableSen: 1533000,
    });
  });

  it('breaks a join-time tie by id', () => {
    const t = '2026-11-01T00:00:00Z';
    const r = allocateShortfall({
      kept: [k('b', 2, t), k('a', 2, t)],
      goodUnitsReceived: 3,
      finalGoodsPriceSen: 14600,
    });
    expect(r.allocations.map((a) => [a.id, a.allocated])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('orders by join time before id and does not change the input order', () => {
    const kept = [k('a', 1, '2026-11-02T00:00:00Z'), k('b', 1, '2026-11-01T00:00:00Z')];
    const r = allocateShortfall({ kept, goodUnitsReceived: 1, finalGoodsPriceSen: 14600 });
    expect(r.allocations.map((a) => a.id)).toEqual(['b', 'a']);
    expect(kept.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('settles an empty kept list as all zeros', () => {
    expect(
      allocateShortfall({ kept: [], goodUnitsReceived: 0, finalGoodsPriceSen: 14600 }),
    ).toEqual({
      allocations: [],
      orderedQuantity: 0,
      receivedCounted: 0,
      excessUnits: 0,
      excessFlag: false,
      supplierPayableSen: 0,
      feeRevenueSen: 0,
      logisticsPayableSen: 0,
      shortfallRefundSen: 0,
    });
  });

  it('spreads a larger shortfall back across the last joiners', () => {
    const t = (n: number) => `2026-11-0${n}T00:00:00Z`;
    const r = allocateShortfall({
      kept: [k('a', 2, t(1)), k('b', 2, t(2)), k('c', 2, t(3))],
      goodUnitsReceived: 3,
      finalGoodsPriceSen: 14600,
    });
    expect(r.allocations.map((a) => [a.id, a.allocated, a.missing])).toEqual([
      ['a', 2, 0],
      ['b', 1, 1],
      ['c', 0, 2],
    ]);
  });

  it('rejects a participation whose goods price differs from the final price', () => {
    const bad = { ...k('a', 1, '2026-11-01T00:00:00Z'), final: unitAmounts(15000, 200, 293) };
    const fields = fieldsOf(() =>
      allocateShortfall({ kept: [bad], goodUnitsReceived: 1, finalGoodsPriceSen: 14600 }),
    );
    expect(fields.map((f) => f.path)).toEqual(['kept[0].final.goodsSen']);
  });

  it('rejects an all-in amount that is not goods plus fee plus shipping', () => {
    const good = k('a', 1, '2026-11-01T00:00:00Z');
    const bad = { ...good, final: { ...good.final, allInSen: good.final.allInSen + 1 } };
    const fields = fieldsOf(() =>
      allocateShortfall({ kept: [bad], goodUnitsReceived: 1, finalGoodsPriceSen: 14600 }),
    );
    expect(fields.map((f) => f.path)).toEqual(['kept[0].final.allInSen']);
  });

  it('rejects a bad received count and a bad final price together', () => {
    const fields = fieldsOf(() =>
      allocateShortfall({ kept: [], goodUnitsReceived: -1, finalGoodsPriceSen: 1.5 }),
    );
    expect(fields.map((f) => f.path)).toEqual(['goodUnitsReceived', 'finalGoodsPriceSen']);
  });

  it('lists every bad participation field in one error', () => {
    const t = '2026-11-01T00:00:00Z';
    const fields = fieldsOf(() =>
      allocateShortfall({
        kept: [k('a', 1, t), { ...k('a', 0, 'not a time'), id: 'a' }, k('', 1, t)],
        goodUnitsReceived: 1,
        finalGoodsPriceSen: 14600,
      }),
    );
    expect(fields.map((f) => f.path)).toEqual([
      'kept[1].id',
      'kept[1].quantity',
      'kept[1].joinedAt',
      'kept[2].id',
    ]);
  });

  it.each(['2026-11-01T10:00:00', '1', 'Nov 1 2026', '2026-11-01'])(
    'rejects the join time %j, which has no offset',
    (bad) => {
      const fields = fieldsOf(() =>
        allocateShortfall({
          kept: [k('a', 1, '2026-11-01T00:00:00Z'), k('b', 1, bad)],
          goodUnitsReceived: 1,
          finalGoodsPriceSen: 14600,
        }),
      );
      expect(fields.map((f) => f.path)).toEqual(['kept[1].joinedAt']);
    },
  );

  it('treats the same instant written two ways as a tie, broken by id', () => {
    const run = (a: string, b: string) =>
      allocateShortfall({
        kept: [k('b', 1, a), k('a', 1, b)],
        goodUnitsReceived: 1,
        finalGoodsPriceSen: 14600,
      }).allocations.map((x) => [x.id, x.missing]);
    const expected = [
      ['a', 0],
      ['b', 1],
    ];
    expect(run('2026-11-01T08:00:00+08:00', '2026-11-01T00:00:00Z')).toEqual(expected);
    expect(run('2026-11-01T00:00:00Z', '2026-11-01T08:00:00+08:00')).toEqual(expected);
  });
});
