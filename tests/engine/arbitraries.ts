import fc from 'fast-check';
import {
  unitAmounts,
  type CloseParticipant,
  type CloseRoundInput,
  type Tier,
} from '@/server/engine';

export const FEE_BPS = 200;
export const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 1000);

const ANCHOR_MS = Date.parse('2026-10-29T12:00:00Z');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 1-5 tiers: minimums strictly increasing within 1-1000, prices strictly decreasing within 100-100000. */
export function arbTiers(): fc.Arbitrary<Tier[]> {
  return fc
    .integer({ min: 1, max: 5 })
    .chain((count) =>
      fc.tuple(
        fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), { minLength: count, maxLength: count }),
        fc.uniqueArray(fc.integer({ min: 100, max: 100_000 }), {
          minLength: count,
          maxLength: count,
        }),
      ),
    )
    .map(([minimums, prices]) => {
      const mins = [...minimums].sort((a, b) => a - b);
      const sorted = [...prices].sort((a, b) => b - a);
      return mins.map((minQuantity, i) => ({ minQuantity, unitPriceSen: sorted[i]! }));
    });
}

/** Within one week of the anchor; duplicates are likely so the id tie-break is exercised. */
export function arbJoinedAt(): fc.Arbitrary<string> {
  return fc
    .integer({ min: 0, max: WEEK_MS })
    .map((offset) => new Date(ANCHOR_MS + offset).toISOString());
}

/** One participation with a valid starting line; the id is assigned by the caller. */
export function arbParticipant(
  tiers: Tier[],
  id: string,
  maxQuantity = 200,
): fc.Arbitrary<CloseParticipant> {
  return fc
    .record({
      quantity: fc.integer({ min: 1, max: maxQuantity }),
      unitShippingSen: fc.integer({ min: 0, max: 1000 }),
      joinedAt: fc.oneof(arbJoinedAt(), fc.constantFrom(...SHARED_TIMES)),
      limitSeed: fc.integer({ min: 0, max: 1_000_000 }),
      hasLimit: fc.boolean(),
    })
    .map(({ quantity, unitShippingSen, joinedAt, limitSeed, hasLimit }) => {
      const starting = unitAmounts(tiers[0]!.unitPriceSen, FEE_BPS, unitShippingSen).allInSen;
      return {
        id,
        quantity,
        joinedAt,
        unitShippingSen,
        priceLimitSen: hasLimit ? 1 + (limitSeed % (starting + 500)) : null,
        paidSen: starting * quantity,
      };
    });
}

const SHARED_TIMES = [0, 1, 2].map((i) => new Date(ANCHOR_MS + i * 3_600_000).toISOString());

/** The wide round: 0-200 participations of 1-200 units, so totals usually clear every tier. */
function arbWideRound(): fc.Arbitrary<CloseRoundInput> {
  return arbTiers().chain((tiers) =>
    fc
      .integer({ min: 0, max: 200 })
      .chain((count) =>
        fc.tuple(...Array.from({ length: count }, (_, i) => arbParticipant(tiers, `p${i}`))),
      )
      .map((participants) => ({ tiers, feeBps: FEE_BPS, participants })),
  );
}

/** A round whose total is aimed across 0 to 1.5 x the top minimum, so tier boundaries are crossed. */
function arbLadderRound(): fc.Arbitrary<CloseRoundInput> {
  return arbTiers().chain((tiers) => {
    const topMin = tiers[tiers.length - 1]!.minQuantity;
    return fc
      .integer({ min: 1, max: Math.ceil(1.5 * topMin) })
      .chain((target) => {
        const minCount = Math.min(200, Math.ceil(target / 200));
        return fc.integer({ min: minCount, max: Math.min(200, target) }).chain((count) => {
          const maxQuantity = Math.min(200, Math.max(1, Math.floor((2 * target) / count)));
          return fc.tuple(
            ...Array.from({ length: count }, (_, i) => arbParticipant(tiers, `p${i}`, maxQuantity)),
          );
        });
      })
      .map((participants) => ({ tiers, feeBps: FEE_BPS, participants }));
  });
}

export function arbRound(): fc.Arbitrary<CloseRoundInput> {
  return fc.oneof(arbLadderRound(), arbLadderRound(), arbWideRound());
}

/** Units received: 0 to floor(1.2 x totalKept). */
export function arbReceived(totalKept: number): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: Math.floor(1.2 * totalKept) });
}
