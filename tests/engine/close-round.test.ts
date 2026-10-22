import { describe, expect, it } from 'vitest';
import { closeRound, EngineInputError, type CloseRoundResult, type Tier } from '@/server/engine';
import { CM_TIERS, EGG_B_TIERS, FEE_BPS, exampleWeekCm, type FixtureParticipant } from './fixtures';

const byId = (r: CloseRoundResult, id: string) => {
  const found = r.participants.find((x) => x.id === id);
  if (!found) throw new Error(`no participant ${id}`);
  return found;
};

const T3: Tier[] = [
  { minQuantity: 10, unitPriceSen: 1000 },
  { minQuantity: 20, unitPriceSen: 900 },
  { minQuantity: 30, unitPriceSen: 800 },
];

/** A participation that paid the starting all-in price of the given tiers (default CM_TIERS). */
function p(
  id: string,
  quantity: number,
  shipping: number,
  tiers: Tier[] = CM_TIERS,
  priceLimitSen: number | null = null,
  joinedAt = '2026-11-01T10:00:00Z',
): FixtureParticipant {
  const goods = tiers[0]!.unitPriceSen;
  const fee = Math.round((goods * FEE_BPS) / 10000);
  return {
    id,
    quantity,
    joinedAt,
    unitShippingSen: shipping,
    priceLimitSen,
    paidSen: (goods + fee + shipping) * quantity,
  };
}

const A = p('A', 15, 0, T3);
const B = p('B', 10, 0, T3, 815);
const C = p('C', 6, 0, T3, 900);

function bgEggs(): FixtureParticipant[] {
  return [20, 18, 15, 14, 12, 11, 10, 8, 7, 5].map((q, i) =>
    p(`egg${i + 1}`, q, 40, EGG_B_TIERS, null, `2026-10-31T0${i}:00:00Z`),
  );
}

describe('closeRound', () => {
  it('closes the example week at tier 3 and refunds the difference', () => {
    const r = closeRound({
      tiers: CM_TIERS,
      feeBps: 200,
      participants: exampleWeekCm(),
      unitName: 'carton',
    });
    expect(r).toMatchObject({
      status: 'formed',
      finalTier: 3,
      finalUnitPriceSen: 14600,
      iterations: 1,
      totalAtCutoff: 105,
      totalKept: 105,
    });
    expect(byId(r, 'kedai')).toMatchObject({
      outcome: 'kept',
      final: { allInSen: 15185 },
      finalLineSen: 91110,
      refundSen: 7344,
    });
    expect(byId(r, 'gerai')).toMatchObject({
      outcome: 'kept',
      final: { allInSen: 15321 },
      refundSen: 4896,
    });
    expect(byId(r, 'kedai').reason).toBe('Kept at tier 3: RM 151.85 all-in. Refund: RM 73.44.');
  });

  it('drops Kafe Contoh for its price limit and re-checks the round (PRD §6.13)', () => {
    const r = closeRound({
      tiers: EGG_B_TIERS,
      feeBps: 200,
      participants: [
        ...bgEggs(),
        {
          id: 'kafe',
          quantity: 10,
          joinedAt: '2026-11-01T22:03:00Z',
          unitShippingSen: 40,
          priceLimitSen: 1220,
          paidSen: 12330,
        },
      ],
      unitName: 'tray',
    });
    expect(r).toMatchObject({
      status: 'formed',
      finalTier: 1,
      iterations: 2,
      totalAtCutoff: 130,
      totalKept: 120,
    });
    expect(byId(r, 'kafe')).toMatchObject({
      outcome: 'dropped_price_limit',
      final: { allInSen: 1233 },
      finalLineSen: 0,
      refundSen: 12330,
    });
    expect(byId(r, 'kafe').reason).toBe(
      'Dropped: the final all-in price of RM 12.33 is above your limit of RM 12.20. Full refund: RM 123.30.',
    );
  });

  it('cascades: one dropout lowers the tier and drops another', () => {
    const r = closeRound({ tiers: T3, feeBps: 200, participants: [A, B, C] });
    expect(r).toMatchObject({ status: 'formed', finalTier: 1, iterations: 3, totalKept: 15 });
    expect([byId(r, 'B').outcome, byId(r, 'C').outcome, byId(r, 'A').refundSen]).toEqual([
      'dropped_price_limit',
      'dropped_price_limit',
      0,
    ]);
  });

  it('keeps a participation whose limit equals the final all-in price', () => {
    const r = closeRound({
      tiers: CM_TIERS,
      feeBps: 200,
      participants: [{ ...p('x', 100, 293), priceLimitSen: 15185 }],
    });
    expect(byId(r, 'x').outcome).toBe('kept');
  });

  it('fails below the minimum and refunds everyone in full', () => {
    const r = closeRound({
      tiers: CM_TIERS,
      feeBps: 200,
      participants: [p('a', 12, 293), p('b', 7, 429)],
      unitName: 'carton',
    });
    expect(r).toMatchObject({
      status: 'failed',
      finalTier: null,
      totals: { refundSen: 12 * 16409 + 7 * 16545, keptSen: 0 },
    });
    expect(byId(r, 'a').reason).toBe(
      "The round didn't reach its minimum of 20 cartons. Full refund: RM 1,969.08.",
    );
  });

  it('is empty with no participations', () =>
    expect(closeRound({ tiers: CM_TIERS, feeBps: 200, participants: [] })).toMatchObject({
      status: 'empty',
      iterations: 0,
      participants: [],
    }));

  it('says no refund when the kept participation paid the final price', () => {
    const r = closeRound({ tiers: CM_TIERS, feeBps: 200, participants: [p('a', 20, 293)] });
    expect(byId(r, 'a')).toMatchObject({ outcome: 'kept', refundSen: 0 });
    expect(byId(r, 'a').reason).toBe(
      'Kept at tier 1: RM 164.09 all-in. No refund: you paid the final price.',
    );
  });

  it('refunds earlier dropouts as dropped and the rest as failed when the round then fails', () => {
    const r = closeRound({
      tiers: CM_TIERS,
      feeBps: 200,
      participants: [p('a', 15, 293), p('b', 10, 293, CM_TIERS, 100)],
    });
    expect(r.status).toBe('failed');
    expect(r.iterations).toBe(2);
    expect(byId(r, 'b').outcome).toBe('dropped_price_limit');
    expect(byId(r, 'a')).toMatchObject({
      outcome: 'refunded_failed',
      final: null,
      finalLineSen: 0,
    });
  });

  it('rejects a payment that is not the starting price', () => {
    expect(() =>
      closeRound({
        tiers: CM_TIERS,
        feeBps: 200,
        participants: [{ ...p('a', 1, 293), paidSen: 1 }],
      }),
    ).toThrow(EngineInputError);
  });

  it('reports the path of every bad field', () => {
    try {
      closeRound({
        tiers: CM_TIERS,
        feeBps: 20000,
        participants: [
          { ...p('a', 0, 293) },
          { ...p('a', 1, -1), joinedAt: 'nope', priceLimitSen: 0 },
        ],
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EngineInputError);
      const paths = (e as EngineInputError).fields.map((f) => f.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          'feeBps',
          'participants[0].quantity',
          'participants[1].id',
          'participants[1].unitShippingSen',
          'participants[1].joinedAt',
          'participants[1].priceLimitSen',
        ]),
      );
    }
  });

  it.each(['2026-11-01T10:00:00', '1', 'Nov 1 2026'])(
    'rejects the join time %j, which has no offset',
    (bad) => {
      try {
        closeRound({
          tiers: CM_TIERS,
          feeBps: 200,
          participants: [{ ...p('a', 1, 293), joinedAt: bad }],
        });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(EngineInputError);
        expect((e as EngineInputError).fields.map((f) => f.path)).toEqual([
          'participants[0].joinedAt',
        ]);
      }
    },
  );
});
