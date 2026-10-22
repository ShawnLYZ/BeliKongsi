import { describe, expect, it } from 'vitest';
import { closeRound, unitAmounts } from '@/server/engine';
import { CM_TIERS, FEE_BPS, type FixtureParticipant } from './fixtures';

/** Small seeded generator so the round is identical on every run. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRound(count: number): FixtureParticipant[] {
  const random = mulberry32(20261021);
  const shippings = [156, 293, 429];
  return Array.from({ length: count }, (_, i) => {
    const quantity = 1 + Math.floor(random() * 3);
    const shipping = shippings[Math.floor(random() * shippings.length)]!;
    const limited = random() < 0.4;
    const priceLimitSen = limited ? 15000 + Math.floor(random() * 1501) : null;
    const start = unitAmounts(CM_TIERS[0]!.unitPriceSen, FEE_BPS, shipping).allInSen;
    return {
      id: `p${i}`,
      quantity,
      joinedAt: new Date(Date.UTC(2026, 9, 30) + i * 60_000).toISOString(),
      unitShippingSen: shipping,
      priceLimitSen,
      paidSen: start * quantity,
    };
  });
}

describe('closing a large round', () => {
  it('closes 1,000 participations in under 200 ms (median of 5 runs)', () => {
    const participants = buildRound(1000);
    const run = () => closeRound({ tiers: CM_TIERS, feeBps: FEE_BPS, participants });

    const first = run();
    expect(first.status).toBe('formed');
    expect(first.iterations).toBeGreaterThanOrEqual(2);

    const durations: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const started = performance.now();
      run();
      durations.push(performance.now() - started);
    }
    durations.sort((a, b) => a - b);
    const median = durations[2]!;
    console.info(`closeRound median ${median.toFixed(2)} ms, iterations ${first.iterations}`);
    expect(median).toBeLessThan(200);
  });
});
