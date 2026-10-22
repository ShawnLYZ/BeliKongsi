import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocateShortfall,
  claimRefund,
  closeRound,
  participationSavings,
  quote,
  type CloseParticipant,
  type CloseRoundInput,
  type CloseRoundResult,
} from '@/server/engine';
import { arbParticipant, arbReceived, arbRound, FEE_BPS, NUM_RUNS } from './arbitraries';

const params = { numRuns: NUM_RUNS };
const TIMEOUT = 120_000;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function keptOf(input: CloseRoundInput, result: CloseRoundResult) {
  return input.participants.flatMap((p, i) => {
    const r = result.participants[i]!;
    return r.outcome === 'kept' && r.final !== null
      ? [{ id: p.id, quantity: p.quantity, joinedAt: p.joinedAt, final: r.final }]
      : [];
  });
}

/** A round, its close result, and a received-units figure sized from the kept total. */
const arbRoundWithReceived = arbRound().chain((input) => {
  const result = closeRound(input);
  return arbReceived(result.totalKept).map((received) => ({ input, result, received }));
});

function numbersIn(value: unknown, skip: Set<string>, path = ''): { path: string; n: number }[] {
  if (typeof value === 'number') return [{ path, n: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbersIn(v, skip, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) =>
      skip.has(k) ? [] : numbersIn(v, skip, `${path}.${k}`),
    );
  }
  return [];
}

describe('engine properties', () => {
  it(
    'money is conserved at close',
    () => {
      fc.assert(
        fc.property(arbRound(), (input) => {
          const result = closeRound(input);
          const paid = sum(input.participants.map((p) => p.paidSen));
          expect(paid).toBe(
            sum(result.participants.map((r) => r.refundSen)) +
              sum(result.participants.map((r) => r.finalLineSen)),
          );
          expect(result.totals.paidSen).toBe(paid);
        }),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'money is conserved after a shortfall',
    () => {
      fc.assert(
        fc.property(arbRoundWithReceived, ({ input, result, received }) => {
          const kept = keptOf(input, result);
          if (kept.length === 0) return;
          const out = allocateShortfall({
            kept,
            goodUnitsReceived: received,
            finalGoodsPriceSen: result.finalUnitPriceSen!,
          });
          expect(result.totals.keptSen).toBe(
            out.supplierPayableSen +
              out.feeRevenueSen +
              out.logisticsPayableSen +
              out.shortfallRefundSen,
          );
        }),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'the final price is never above the starting price',
    () => {
      fc.assert(
        fc.property(arbRound(), (input) => {
          const result = closeRound(input);
          if (result.finalUnitPriceSen !== null) {
            expect(result.finalUnitPriceSen).toBeLessThanOrEqual(input.tiers[0]!.unitPriceSen);
          }
          result.participants.forEach((r, i) => {
            if (r.outcome === 'kept') {
              expect(r.finalLineSen).toBeLessThanOrEqual(input.participants[i]!.paidSen);
            }
          });
        }),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'no kept participation pays above its limit',
    () => {
      fc.assert(
        fc.property(arbRound(), (input) => {
          const result = closeRound(input);
          result.participants.forEach((r, i) => {
            const limit = input.participants[i]!.priceLimitSen;
            if (r.outcome === 'kept' && limit !== null) {
              expect(r.final!.allInSen).toBeLessThanOrEqual(limit);
            }
          });
        }),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'below the minimum everyone is refunded in full',
    () => {
      fc.assert(
        fc.property(arbRound(), (input) => {
          const total = sum(input.participants.map((p) => p.quantity));
          const result = closeRound(input);
          if (total < input.tiers[0]!.minQuantity) {
            expect(['failed', 'empty']).toContain(result.status);
          }
          // Includes failure after price-limit dropouts, not only a raw total below the minimum.
          if (result.status !== 'formed') {
            result.participants.forEach((r, i) => {
              expect(r.refundSen).toBe(input.participants[i]!.paidSen);
              expect(r.finalLineSen).toBe(0);
            });
          }
        }),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'every amount is a non-negative integer',
    () => {
      const skip = new Set(['unitSavingSen', 'savingSen']);
      const check = (value: unknown) => {
        for (const { path, n } of numbersIn(value, skip)) {
          expect(Number.isSafeInteger(n), path).toBe(true);
          expect(n, path).toBeGreaterThanOrEqual(0);
        }
      };
      fc.assert(
        fc.property(
          arbRoundWithReceived,
          fc.integer({ min: 0, max: 5000 }),
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 3 }),
          fc.boolean(),
          (
            { input, result, received },
            currentRoundTotal,
            missingExtra,
            damagedExtra,
            verified,
          ) => {
            check(result);
            const kept = keptOf(input, result);
            const alloc = allocateShortfall({
              kept,
              goodUnitsReceived: received,
              finalGoodsPriceSen: result.finalUnitPriceSen ?? 0,
            });
            check(alloc);

            check(
              quote({
                tiers: input.tiers,
                feeBps: FEE_BPS,
                unitShippingSen: 100,
                quantity: 3,
                currentRoundTotal,
                priceLimitSen: null,
                unitName: 'unit',
              }),
            );

            const first = kept[0];
            if (first !== undefined) {
              const a = alloc.allocations.find((x) => x.id === first.id)!;
              const claim = claimRefund({
                final: first.final,
                allocated: a.allocated,
                missing: missingExtra,
                damaged: damagedExtra,
              });
              if (claim.ok) check(claim);
              check(
                participationSavings({
                  baselineSen: first.final.allInSen + 500,
                  baselineKind: 'usual',
                  finalAllInSen: first.final.allInSen,
                  allocated: a.allocated,
                  missing: 0,
                  damaged: 0,
                  verified,
                }),
              );
            }
          },
        ),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'the same input gives the same output, in any order',
    () => {
      fc.assert(
        fc.property(
          arbRound().chain((input) =>
            fc
              .shuffledSubarray(
                input.participants.map((_, i) => i),
                { minLength: input.participants.length, maxLength: input.participants.length },
              )
              .map((order) => ({ input, order })),
          ),
          ({ input, order }) => {
            const shuffled = { ...input, participants: order.map((i) => input.participants[i]!) };
            const a = closeRound(input);
            const b = closeRound(shuffled);
            expect(b.status).toBe(a.status);
            expect(b.finalTier).toBe(a.finalTier);
            expect(b.finalUnitPriceSen).toBe(a.finalUnitPriceSen);
            expect(b.iterations).toBe(a.iterations);
            expect(b.totalAtCutoff).toBe(a.totalAtCutoff);
            expect(b.totalKept).toBe(a.totalKept);
            expect(b.totals).toEqual(a.totals);
            const byId = new Map(b.participants.map((r) => [r.id, r]));
            for (const r of a.participants) expect(byId.get(r.id)).toEqual(r);
          },
        ),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'closing the kept participations again changes nothing',
    () => {
      fc.assert(
        fc.property(arbRound(), (input) => {
          const first = closeRound(input);
          fc.pre(first.status === 'formed');
          const keptIds = new Set(
            first.participants.filter((r) => r.outcome === 'kept').map((r) => r.id),
          );
          const again = closeRound({
            ...input,
            participants: input.participants.filter((p) => keptIds.has(p.id)),
          });
          expect(again.status).toBe('formed');
          expect(again.finalTier).toBe(first.finalTier);
          expect(again.finalUnitPriceSen).toBe(first.finalUnitPriceSen);
          const before = new Map(first.participants.map((r) => [r.id, r]));
          for (const r of again.participants) {
            expect(r.outcome).toBe('kept');
            expect(r.finalLineSen).toBe(before.get(r.id)!.finalLineSen);
            expect(r.refundSen).toBe(before.get(r.id)!.refundSen);
          }
        }),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'allocation sums to min(received, ordered), respects join order, and refunds missing x all-in',
    () => {
      fc.assert(
        fc.property(arbRoundWithReceived, ({ input, result, received }) => {
          const kept = keptOf(input, result);
          const out = allocateShortfall({
            kept,
            goodUnitsReceived: received,
            finalGoodsPriceSen: result.finalUnitPriceSen ?? 0,
          });
          const ordered = sum(kept.map((k) => k.quantity));
          expect(sum(out.allocations.map((a) => a.allocated))).toBe(Math.min(received, ordered));

          const byId = new Map(kept.map((k) => [k.id, k]));
          const expectedOrder = [...kept].sort((a, b) => {
            const t = Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
            return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
          });
          expect(out.allocations.map((a) => a.id)).toEqual(expectedOrder.map((k) => k.id));

          // A run of full quantities, at most one partial, then zeros.
          let inFullRun = true;
          let partials = 0;
          for (const a of out.allocations) {
            const k = byId.get(a.id)!;
            expect(a.allocated + a.missing).toBe(k.quantity);
            expect(a.refundSen).toBe(a.missing * k.final.allInSen);
            if (a.allocated === k.quantity) {
              expect(inFullRun).toBe(true);
            } else if (a.allocated > 0) {
              expect(inFullRun).toBe(true);
              partials += 1;
              inFullRun = false;
            } else {
              inFullRun = false;
            }
          }
          expect(partials).toBeLessThanOrEqual(1);
        }),
        params,
      );
    },
    TIMEOUT,
  );

  it(
    'adding a no-limit participation never raises the final price',
    () => {
      fc.assert(
        fc.property(
          arbRound().chain((input) =>
            arbParticipant(input.tiers, 'extra').map((extra) => ({
              input,
              extra: { ...extra, priceLimitSen: null } satisfies CloseParticipant,
            })),
          ),
          ({ input, extra }) => {
            const before = closeRound(input);
            fc.pre(before.status === 'formed');
            const after = closeRound({ ...input, participants: [...input.participants, extra] });
            expect(after.status).toBe('formed');
            expect(after.finalUnitPriceSen!).toBeLessThanOrEqual(before.finalUnitPriceSen!);
          },
        ),
        params,
      );
    },
    TIMEOUT,
  );
});
