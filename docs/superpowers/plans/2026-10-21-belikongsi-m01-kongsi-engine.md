# M1 Kongsi Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every money rule in PRD §6 as a pure, deterministic TypeScript module, proven by example and property tests and exposed as the stateless public Kongsi Engine API v1.

**Architecture:** `src/server/engine/` has no I/O, no clock and no imports from outside itself (lint-enforced since M0). Services in later milestones and the public API routes both call it, so each rule exists exactly once. The public API lives in `src/server/modules/integration/engine-api.ts` (Zod schemas and mapping) and three thin route handlers.

**Tech Stack:** TypeScript 6, Vitest 5, fast-check 4, Zod 4, Next.js route handlers.

**Spec:** PRD §6 (all), §20 "Public Kongsi Engine API", Testing Decisions "Seams" 1; build design O4, C1; index §5.8.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §6.1: "Every amount is a whole number of sen. Rounding is half-up on non-negative values, applied once per unit amount." Line amounts are unit amount × quantity.
- PRD §6.3: fee = round(goods × fee basis points ÷ 10,000); the fee is 200 basis points.
- PRD §6.2: 1 to 5 tiers; minimum quantities are positive whole numbers that strictly increase; unit prices are positive and strictly decrease. Product rule (PRD §4): every tier price is below the buy-alone price.
- Tier positions in every result are 1-based ("tier 3").
- Public engine API: no session, nothing stored, versioned path `/api/engine/v1/…`, a 422 with a field list on bad input (PRD §20).
- Property tests read the run count from `FC_NUM_RUNS` (default 1000; CI sets 5000).

## Review Focus

1. **Two participations with the same join time at the shortfall boundary:** the tie is broken by id, ascending, so the result never depends on input order. Pinned in Task 6.
2. **A price limit exactly equal to the final all-in price:** the participation is kept, because only "below its all-in price" drops (PRD §6.6). Pinned in Task 5.
3. **Good units received above the ordered quantity:** they are capped and flagged, and the supplier is paid only for the ordered quantity. Pinned in Task 6.
4. **Engine API input with the wrong types** (strings for numbers, missing tiers): a 422 that lists each bad field path, never a 500. Pinned in Task 10.
5. **A round of only no-limit participations exactly at a tier boundary** (total = 100): the higher tier applies, because a tier is reached when its minimum ≤ total. Pinned in Task 2.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m01-kongsi-engine`
- [ ] **Step 2:** Follow index §6. Also confirm that M0's ESLint engine-boundary rule is active: `pnpm test:engine -- lint-rules` passes.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Money helpers

**Files:**

- Create: `src/server/engine/types.ts`, `src/server/engine/money.ts`, `src/server/engine/index.ts`, `tests/engine/fixtures.ts`
- Test: `tests/engine/money.test.ts`

**Interfaces:**

- Produces: `type Sen = number`; `roundHalfUpDiv(numerator: number, denominator: number): number` (both non-negative integers; throws `RangeError` otherwise); `feeSen(goodsSen: Sen, feeBps: number): Sen`; `formatRM(sen: number): string`; `formatUnits(quantity: number, unitName: string): string`.
- `tests/engine/fixtures.ts` exports `CM_TIERS`, `EGG_B_TIERS`, `FEE_BPS = 200` and the shipping shares `SHIP_CM_IPOH = 293`, `SHIP_CM_JB = 429`, `SHIP_CM_PJ = 156` and `SHIP_EGG_KUANTAN = 40`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('rounds half up on whole sen', () => {
  expect(roundHalfUpDiv(292_500, 1000)).toBe(293); // 19.5 kg × 15 sen/kg
  expect(roundHalfUpDiv(39_600, 1000)).toBe(40); // 1.8 kg × 22 sen/kg
  expect(roundHalfUpDiv(500, 1000)).toBe(1);
  expect(roundHalfUpDiv(499, 1000)).toBe(0);
});
it('computes the 2% fee per unit, half up', () => {
  expect(feeSen(15800, 200)).toBe(316);
  expect(feeSen(14600, 200)).toBe(292);
  expect(feeSen(1170, 200)).toBe(23); // 23.4
  expect(feeSen(1230, 200)).toBe(25); // 24.6
  expect(feeSen(1125, 200)).toBe(23); // 22.5, the half-sen boundary
  expect(feeSen(1124, 200)).toBe(22);
});
it('formats ringgit', () => {
  expect(formatRM(0)).toBe('RM 0.00');
  expect(formatRM(5)).toBe('RM 0.05');
  expect(formatRM(98454)).toBe('RM 984.54');
  expect(formatRM(1533000)).toBe('RM 15,330.00');
  expect(formatRM(123456789)).toBe('RM 1,234,567.89');
  expect(formatRM(-185)).toBe('-RM 1.85');
});
it('formats unit counts', () => {
  expect(formatUnits(1, 'carton')).toBe('1 carton');
  expect(formatUnits(6, 'carton')).toBe('6 cartons');
  expect(formatUnits(10, 'tray')).toBe('10 trays');
  expect(formatUnits(2, 'tin')).toBe('2 tins');
});
it('refuses negative or fractional inputs to rounding', () => {
  expect(() => roundHalfUpDiv(-1, 10)).toThrow(RangeError);
  expect(() => roundHalfUpDiv(1.5, 10)).toThrow(RangeError);
});
```

- [ ] **Step 2:** Run `pnpm test:engine -- money`. Expected: FAIL.
- [ ] **Step 3: Implement** `money.ts`.
  - `roundHalfUpDiv` is `Math.floor((2 * n + d) / (2 * d))` on safe integers.
  - `formatRM` uses integer arithmetic plus `Intl.NumberFormat('en-MY')` for the grouping only.
  - Export everything through `index.ts`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): add money helpers`

---

### Task 2: Tier validation and tier lookup

**Files:**

- Create: `src/server/engine/tiers.ts`
- Test: `tests/engine/tiers.test.ts`

**Interfaces:**

- Produces:
  - `interface Tier { minQuantity: number; unitPriceSen: Sen }`.
  - `type TierErrorCode = 'TIER_COUNT' | 'MIN_QUANTITY_NOT_POSITIVE_INTEGER' | 'MIN_QUANTITY_NOT_INCREASING' | 'PRICE_NOT_POSITIVE_INTEGER' | 'PRICE_NOT_DECREASING' | 'PRICE_NOT_BELOW_BUY_ALONE'`.
  - `interface TierError { code: TierErrorCode; position: number | null; message: string }`.
  - `validateTiers(tiers: Tier[], opts?: { buyAlonePriceSen?: Sen }): { ok: true } | { ok: false; errors: TierError[] }`, which reports every error, not just the first.
  - `tierForTotal(tiers: Tier[], total: number): number | null`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('accepts the condensed milk ladder', () =>
  expect(validateTiers(CM_TIERS, { buyAlonePriceSen: 16800 })).toEqual({ ok: true }));
it('needs between 1 and 5 tiers', () => {
  expect(validateTiers([])).toMatchObject({
    ok: false,
    errors: [{ code: 'TIER_COUNT', position: null }],
  });
  expect(
    validateTiers(
      Array.from({ length: 6 }, (_, i) => ({ minQuantity: i + 1, unitPriceSen: 100 - i })),
    ),
  ).toMatchObject({ ok: false, errors: [{ code: 'TIER_COUNT' }] });
});
it('reports a minimum that does not increase, at its position', () => {
  expect(
    validateTiers([
      { minQuantity: 20, unitPriceSen: 200 },
      { minQuantity: 20, unitPriceSen: 100 },
    ]),
  ).toMatchObject({ ok: false, errors: [{ code: 'MIN_QUANTITY_NOT_INCREASING', position: 2 }] });
});
it('reports a price that does not decrease', () => {
  expect(
    validateTiers([
      { minQuantity: 20, unitPriceSen: 15800 },
      { minQuantity: 50, unitPriceSen: 15800 },
    ]),
  ).toMatchObject({ ok: false, errors: [{ code: 'PRICE_NOT_DECREASING', position: 2 }] });
});
it('rejects zero or fractional quantities and prices', () => {
  const r = validateTiers([{ minQuantity: 0, unitPriceSen: 10.5 }]);
  expect(r.ok === false && r.errors.map((e) => e.code)).toEqual([
    'MIN_QUANTITY_NOT_POSITIVE_INTEGER',
    'PRICE_NOT_POSITIVE_INTEGER',
  ]);
});
it('needs every tier below the buy-alone price', () => {
  expect(
    validateTiers([{ minQuantity: 10, unitPriceSen: 12000 }], { buyAlonePriceSen: 12000 }),
  ).toMatchObject({ ok: false, errors: [{ code: 'PRICE_NOT_BELOW_BUY_ALONE', position: 1 }] });
});
it('finds the highest tier reached', () => {
  expect([19, 20, 49, 50, 99, 100, 105].map((t) => tierForTotal(CM_TIERS, t))).toEqual([
    null,
    1,
    1,
    2,
    2,
    3,
    3,
  ]);
});
```

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `tiers.ts`. Messages are plain English, e.g. `"Tier 2's minimum must be more than tier 1's."`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): validate tiers and find the tier reached`

---

### Task 3: Unit amounts

**Files:**

- Create: `src/server/engine/amounts.ts`
- Test: `tests/engine/amounts.test.ts`

**Interfaces:**

- Produces: `interface UnitAmounts { goodsSen: Sen; feeSen: Sen; shippingSen: Sen; allInSen: Sen }` and `unitAmounts(goodsSen: Sen, feeBps: number, unitShippingSen: Sen): UnitAmounts`.

- [ ] **Step 1: Write the failing tests:**

```ts
it.each([
  [
    'condensed milk, Ipoh, starting',
    15800,
    293,
    { goodsSen: 15800, feeSen: 316, shippingSen: 293, allInSen: 16409 },
  ],
  [
    'condensed milk, Ipoh, tier 3',
    14600,
    293,
    { goodsSen: 14600, feeSen: 292, shippingSen: 293, allInSen: 15185 },
  ],
  [
    'condensed milk, Johor Bahru, starting',
    15800,
    429,
    { goodsSen: 15800, feeSen: 316, shippingSen: 429, allInSen: 16545 },
  ],
  [
    'condensed milk, Johor Bahru, tier 3',
    14600,
    429,
    { goodsSen: 14600, feeSen: 292, shippingSen: 429, allInSen: 15321 },
  ],
  [
    'Grade B eggs, Kuantan, tier 1',
    1170,
    40,
    { goodsSen: 1170, feeSen: 23, shippingSen: 40, allInSen: 1233 },
  ],
  [
    'Grade B eggs, Kuantan, tier 2',
    1130,
    40,
    { goodsSen: 1130, feeSen: 23, shippingSen: 40, allInSen: 1193 },
  ],
])('%s', (_name, goods, ship, expected) =>
  expect(unitAmounts(goods, FEE_BPS, ship)).toEqual(expected),
);
```

- [ ] **Step 2:** Run. Expected: FAIL. **Step 3:** Implement. **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): compute all-in unit amounts`

---

### Task 4: Quotes and their explanation

**Files:**

- Create: `src/server/engine/quote.ts`, `src/server/engine/explain.ts`
- Test: `tests/engine/quote.test.ts`

**Interfaces:**

- Produces:

```ts
interface QuoteInput {
  tiers: Tier[];
  feeBps: number;
  unitShippingSen: Sen;
  quantity: number; // the caller's quantity, ≥ 1
  currentRoundTotal: number; // units already in the round, NOT counting `quantity`
  priceLimitSen?: Sen | null;
  unitName: string; // 'carton', 'tray', … (for sentences)
}
interface TierView {
  position: number;
  minQuantity: number;
  unitPriceSen: Sen;
}
interface Projection {
  total: number;
  tier: number | null;
  amounts: UnitAmounts | null;
  unitsToNextTier: number | null;
  nextTier: TierView | null;
}
interface QuoteResult {
  starting: UnitAmounts;
  startingLineSen: Sen;
  withoutYou: Projection;
  withYou: Projection;
  limit: null | {
    priceLimitSen: Sen;
    belowStarting: boolean;
    lowestTierMeetingLimit: (TierView & { allInSen: Sen }) | null;
  };
  explanation: string[];
}
function quote(input: QuoteInput): QuoteResult;
```

- Below the minimum: `tier` and `amounts` are `null`, and `unitsToNextTier` is the number of units needed to reach tier 1.
- At the top tier: `unitsToNextTier` and `nextTier` are `null`.

- [ ] **Step 1: Write the failing tests.** These are the C1 example and the PRD §6.4 warning:

```ts
const cm = (q: Partial<QuoteInput> = {}) =>
  quote({
    tiers: CM_TIERS,
    feeBps: 200,
    unitShippingSen: 293,
    quantity: 6,
    currentRoundTotal: 99,
    unitName: 'carton',
    ...q,
  });
it('shows the round without you and with you (C1)', () => {
  const r = cm();
  expect(r.starting.allInSen).toBe(16409);
  expect(r.startingLineSen).toBe(98454);
  expect(r.withoutYou).toMatchObject({
    total: 99,
    tier: 2,
    unitsToNextTier: 1,
    nextTier: { position: 3, minQuantity: 100, unitPriceSen: 14600 },
  });
  expect(r.withYou).toMatchObject({
    total: 105,
    tier: 3,
    amounts: { allInSen: 15185 },
    unitsToNextTier: null,
    nextTier: null,
  });
  expect(r.explanation).toEqual([
    'You pay RM 164.09 a carton now: the starting price. Anything above the final price comes back to your balance at cut-off.',
    '99 cartons so far. 1 more carton and everyone pays RM 146.00.',
    'Your 6 cartons take it to 105: the RM 146.00 tier.',
    'Your all-in price: RM 151.85 (RM 146.00 goods + RM 2.92 BeliKongsi fee + RM 2.93 shipping).',
  ]);
});
it('warns when the limit is below the starting price (Kafe Contoh, Grade B eggs)', () => {
  const r = quote({
    tiers: EGG_B_TIERS,
    feeBps: 200,
    unitShippingSen: 40,
    quantity: 10,
    currentRoundTotal: 120,
    priceLimitSen: 1220,
    unitName: 'tray',
  });
  expect(r.limit).toEqual({
    priceLimitSen: 1220,
    belowStarting: true,
    lowestTierMeetingLimit: { position: 2, minQuantity: 300, unitPriceSen: 1130, allInSen: 1193 },
  });
  expect(r.explanation).toContain("You'll only be in if the round reaches 300+ trays.");
});
it('says so when no tier meets the limit', () => {
  const r = quote({
    tiers: EGG_B_TIERS,
    feeBps: 200,
    unitShippingSen: 40,
    quantity: 10,
    currentRoundTotal: 0,
    priceLimitSen: 1000,
    unitName: 'tray',
  });
  expect(r.limit?.lowestTierMeetingLimit).toBeNull();
  expect(r.explanation).toContain(
    'No price tier is within your limit of RM 10.00, so this line would be refunded at cut-off.',
  );
});
it('explains a round still below its minimum', () => {
  const r = cm({ quantity: 2, currentRoundTotal: 10 });
  expect(r.withYou).toMatchObject({ total: 12, tier: null, amounts: null, unitsToNextTier: 8 });
  expect(r.explanation).toContain(
    "The round needs 8 more cartons to reach its minimum of 20. If it doesn't, everyone is refunded in full.",
  );
});
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`quote.ts`:**
    - "with you" uses `currentRoundTotal + quantity`.
    - The limit is evaluated against the starting all-in price. The lowest tier meeting the limit is the first position whose all-in is ≤ the limit.
  - **`explain.ts`:** export `explainQuote(result: QuoteResult, quantity: number, unitName: string): string[]`, producing exactly the sentences in the tests, in this order:
    1. what you pay now
    2. without you
    3. with you, or below the minimum
    4. your all-in breakdown, only when `withYou.amounts` exists
    5. limit sentences
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): quote a line with and without the caller`

---

### Task 5: Closing a round

**Files:**

- Create: `src/server/engine/close-round.ts`
- Modify: `src/server/engine/explain.ts`
- Test: `tests/engine/close-round.test.ts`

**Interfaces:**

- Produces:

```ts
interface CloseParticipant {
  id: string;
  quantity: number;
  joinedAt: string;
  unitShippingSen: Sen;
  priceLimitSen: Sen | null;
  paidSen: Sen;
}
interface CloseRoundInput {
  tiers: Tier[];
  feeBps: number;
  participants: CloseParticipant[];
  unitName?: string;
}
type CloseOutcome = 'kept' | 'dropped_price_limit' | 'refunded_failed';
interface CloseParticipantResult {
  id: string;
  outcome: CloseOutcome;
  final: UnitAmounts | null;
  finalLineSen: Sen;
  refundSen: Sen;
  reason: string;
}
interface CloseRoundResult {
  status: 'empty' | 'failed' | 'formed';
  finalTier: number | null;
  finalUnitPriceSen: Sen | null;
  iterations: number;
  totalAtCutoff: number;
  totalKept: number;
  participants: CloseParticipantResult[];
  totals: { paidSen: Sen; refundSen: Sen; keptSen: Sen };
}
class EngineInputError extends Error {
  fields: { path: string; message: string }[];
}
function closeRound(input: CloseRoundInput): CloseRoundResult; // throws EngineInputError
```

- `final` is: the final amounts for `kept`; the amounts at the tier that dropped it for `dropped_price_limit`; `null` for `refunded_failed`.
- Participants come back in input order.
- Validation: `validateTiers`; `feeBps` an integer from 0 to 10000; unique ids; quantity a positive integer; shipping a non-negative integer; limit null or a positive integer; `joinedAt` a valid ISO time; `paidSen === unitAmounts(tier 1 price, feeBps, unitShippingSen).allInSen × quantity`.

- [ ] **Step 1: Write the failing tests.** Fixture `exampleWeekCm()` builds the 9 participations of index §5.7 in join order: background quantities 20, 18, 16, 14, 12, 12 with shipping 293, 429, 429, 156, 293, 293 and no limits; Gerai 4 @ 429 (limit 16800); Kafe 3 @ 429 (limit 16700); Kedai Kopi 6 @ 293 (limit 16500). Each pays its starting all-in × quantity.

```ts
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
  // tiers 10:1000, 20:900, 30:800; fee 200; shipping 0 → all-in 1020 / 918 / 816
  // A 15 no limit; B 10 limit 815; C 6 limit 900 (each paid 1020 × quantity)
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
it('rejects a payment that is not the starting price', () => {
  expect(() =>
    closeRound({ tiers: CM_TIERS, feeBps: 200, participants: [{ ...p('a', 1, 293), paidSen: 1 }] }),
  ).toThrow(EngineInputError);
});
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** PRD §6.6 exactly as written: the loop of total, tier, all-in per participation, and dropping those with `priceLimitSen !== null && priceLimitSen < allIn`. Add `explainOutcome(result: CloseParticipantResult, ctx: { finalTier: number | null; minQuantity: number; unitName: string; priceLimitSen: Sen | null }): string` to `explain.ts`, producing the `reason` strings above. A kept participation with zero refund gets `'Kept at tier 1: RM 164.09 all-in. No refund: you paid the final price.'`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): close rounds with price-limit dropouts`

---

### Task 6: Shortfall allocation

**Files:**

- Create: `src/server/engine/shortfall.ts`
- Test: `tests/engine/shortfall.test.ts`

**Interfaces:**

- Produces:

```ts
interface KeptForAllocation {
  id: string;
  quantity: number;
  joinedAt: string;
  final: UnitAmounts;
}
interface AllocateShortfallInput {
  kept: KeptForAllocation[];
  goodUnitsReceived: number;
  finalGoodsPriceSen: Sen;
}
interface AllocationResult {
  id: string;
  allocated: number;
  missing: number;
  refundSen: Sen;
}
interface AllocateShortfallResult {
  allocations: AllocationResult[]; // in first-come order: joinedAt, then id
  orderedQuantity: number;
  receivedCounted: number;
  excessUnits: number;
  excessFlag: boolean;
  supplierPayableSen: Sen;
  feeRevenueSen: Sen;
  logisticsPayableSen: Sen;
  shortfallRefundSen: Sen;
}
function allocateShortfall(input: AllocateShortfallInput): AllocateShortfallResult; // throws EngineInputError when a kept participation's goodsSen ≠ finalGoodsPriceSen
```

- [ ] **Step 1: Write the failing tests.** `keptFromClose()` maps the Task 5 example-week result to `KeptForAllocation[]`.

```ts
it('allocates a 5-carton shortfall to the last joiner (PRD §6.13)', () => {
  const r = allocateShortfall({
    kept: keptFromClose(),
    goodUnitsReceived: 100,
    finalGoodsPriceSen: 14600,
  });
  expect(r.allocations.at(-1)).toEqual({ id: 'kedai', allocated: 1, missing: 5, refundSen: 75925 });
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
    allocateShortfall({ kept: keptFromClose(), goodUnitsReceived: 105, finalGoodsPriceSen: 14600 }),
  ).toMatchObject({ supplierPayableSen: 1533000, shortfallRefundSen: 0 });
});
it('caps and flags units above the ordered quantity', () => {
  expect(
    allocateShortfall({ kept: keptFromClose(), goodUnitsReceived: 110, finalGoodsPriceSen: 14600 }),
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
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** PRD §6.7:
  - `receivedCounted = min(R, ordered)`.
  - Allocate in first-come order.
  - `refund = missing × final.allInSen`.
  - Supplier payable = `receivedCounted × finalGoodsPriceSen`.
  - Fee revenue and logistics payable are summed per participation (allocated × unit fee or unit shipping).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): allocate shortfalls first come, first served`

---

### Task 7: Claim refunds and savings

**Files:**

- Create: `src/server/engine/claims.ts`, `src/server/engine/savings.ts`
- Test: `tests/engine/claims-savings.test.ts`

**Interfaces:**

- Produces:
  - `claimRefund(input: { final: UnitAmounts; allocated: number; missing: number; damaged: number }): { ok: true; refundSen: Sen } | { ok: false; code: 'NEGATIVE_UNITS' | 'MORE_THAN_ALLOCATED'; message: string }`.
  - `participationSavings(input: { baselineSen: Sen; baselineKind: 'usual' | 'buy_alone'; finalAllInSen: Sen; allocated: number; missing: number; damaged: number; verified: boolean }): { unitSavingSen: number; units: number; savingSen: number; status: 'estimated' | 'verified'; basis: 'usual_price' | 'buy_alone' }`.
    - Estimated units = `allocated`; verified units = `allocated − missing − damaged`.
    - `unitSavingSen` may be negative (PRD §6.10).

- [ ] **Step 1: Write the failing tests:**

```ts
const cmIpohFinal = unitAmounts(14600, 200, 293);
it('refunds a damaged carton at the final all-in price', () =>
  expect(claimRefund({ final: cmIpohFinal, allocated: 6, missing: 0, damaged: 1 })).toEqual({
    ok: true,
    refundSen: 15185,
  }));
it('refuses more missing plus damaged than allocated', () =>
  expect(claimRefund({ final: cmIpohFinal, allocated: 6, missing: 4, damaged: 3 })).toMatchObject({
    ok: false,
    code: 'MORE_THAN_ALLOCATED',
  }));
it('verifies Kedai Kopi Contoh savings after one damaged carton', () => {
  expect(
    participationSavings({
      baselineSen: 16500,
      baselineKind: 'usual',
      finalAllInSen: 15185,
      allocated: 6,
      missing: 0,
      damaged: 1,
      verified: true,
    }),
  ).toEqual({
    unitSavingSen: 1315,
    units: 5,
    savingSen: 6575,
    status: 'verified',
    basis: 'usual_price',
  });
});
it('estimates before the check and labels the buy-alone fallback', () => {
  expect(
    participationSavings({
      baselineSen: 16800,
      baselineKind: 'buy_alone',
      finalAllInSen: 15321,
      allocated: 4,
      missing: 0,
      damaged: 0,
      verified: false,
    }),
  ).toEqual({
    unitSavingSen: 1479,
    units: 4,
    savingSen: 5916,
    status: 'estimated',
    basis: 'buy_alone',
  });
});
it('shows a negative saving honestly', () => {
  expect(
    participationSavings({
      baselineSen: 15000,
      baselineKind: 'usual',
      finalAllInSen: 15185,
      allocated: 2,
      missing: 0,
      damaged: 0,
      verified: true,
    }).savingSen,
  ).toBe(-370);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): add claim refunds and savings`

---

### Task 8: Property tests

**Files:**

- Create: `tests/engine/arbitraries.ts`, `tests/engine/properties.test.ts`

**Interfaces:**

- Produces these arbitraries:
  - `arbTiers()`: 1–5 tiers; minimums strictly increasing within 1–1000; prices strictly decreasing within 100–100000.
  - `arbRound()`: `{ tiers, feeBps: 200, participants }`, with 0–200 participations; quantity 1–200; shipping 0–1000; limits null or random in 1–(starting all-in + 500); `joinedAt` within one week; ids unique; `paidSen` the starting line.
  - `arbReceived(totalKept)`: 0 to `floor(1.2 × totalKept)`.

- [ ] **Step 1: Write the properties** (each `fc.assert(…, { numRuns: Number(process.env.FC_NUM_RUNS ?? 1000) })`):
  1. `money is conserved at close`: Σ paid = Σ refund + Σ finalLine.
  2. `money is conserved after a shortfall`: Σ finalLine of kept = supplier payable + fee revenue + logistics payable + shortfall refunds.
  3. `the final price is never above the starting price`.
  4. `no kept participation pays above its limit`.
  5. `below the minimum everyone is refunded in full`: if Σ quantity < tier 1's minimum, the status is `failed` (or `empty`) and every refund equals `paidSen`.
  6. `every amount is a non-negative integer`: walk every number in the results; `unitSavingSen` is excluded.
  7. `the same input gives the same output, in any order`: compare results by id after shuffling the participants.
  8. `closing the kept participations again changes nothing`.
  9. `allocation sums to min(received, ordered), respects join order, and refunds missing × all-in`.
  10. `adding a no-limit participation never raises the final price`.
- [ ] **Step 2:** Run `pnpm test:engine -- properties`. Expected: PASS, because Tasks 1–7 exist. If a property fails, fix the engine, not the property, and add the shrunk counter-example as a named example test in the relevant file.
- [ ] **Step 3:** Run `FC_NUM_RUNS=5000 pnpm test:engine -- properties`. Expected: PASS.
- [ ] **Step 4: Commit:** `test(engine): add property tests for the money rules`

---

### Task 9: Performance check

**Files:**

- Test: `tests/engine/performance.test.ts`

- [ ] **Step 1: Write the test.**
  - Build a fixed-seed round of 1,000 participations with CM tiers, where 40% have limits between 15000 and 16500, forcing a multi-iteration cascade.
  - `closeRound` runs 5 times; the median duration must be < 200 ms (PRD §22).
- [ ] **Step 2:** Run. Expected: PASS. If it fails, use incremental totals across iterations instead of re-summing; behaviour must not change (the property tests guard it).
- [ ] **Step 3: Commit:** `test(engine): check 1,000-participation close stays under 200 ms`

---

### Task 10: Public Kongsi Engine API v1 and its documentation

**Files:**

- Create: `src/server/modules/integration/engine-api.ts`, `src/app/api/engine/v1/quote/route.ts`, `src/app/api/engine/v1/close-round/route.ts`, `src/app/api/engine/v1/allocate-shortfall/route.ts`, `docs/engine-api.md`
- Test: `tests/api/engine-api.test.ts`

**Interfaces:**

- Consumes: `quote`, `closeRound`, `allocateShortfall`, `EngineInputError` (Tasks 4–6); `route`, `json` (M0).
- Produces:
  - **Request bodies:**
    - Quote: as `QuoteInput`, with `unitName` optional (default `'unit'`).
    - Close-round: participants carry `reference` in place of `id`; `priceLimitSen` is optional.
    - Allocate-shortfall: `kept[]` carries `reference`, `quantity`, `joinedAt`, `final`; plus `goodUnitsReceived` and `finalGoodsPriceSen`.
  - **Responses** mirror the engine results, with `id` renamed to `reference`.
  - **Headers:** an optional `X-Orbyte-App-Id` is accepted and logged as `[engine-api] app=<id, first 64 chars> op=<operation>`.
  - **Errors:** a 422 `{ code: 'INVALID_ENGINE_INPUT', message: 'Some fields are not valid.', details: { fields: [{ path, message }] } }`, for both Zod failures and `EngineInputError`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('quotes the condensed milk example', async () => {
  const res = await callRoute('POST', '/api/engine/v1/quote', {
    body: {
      tiers: CM_TIERS,
      feeBps: 200,
      unitShippingSen: 293,
      quantity: 6,
      currentRoundTotal: 99,
      unitName: 'carton',
    },
  });
  expect(res.status).toBe(200);
  expect(res.body.withYou.amounts.allInSen).toBe(15185);
});
it('closes a round and answers with references', async () => {
  const res = await callRoute('POST', '/api/engine/v1/close-round', {
    body: { tiers: EGG_B_TIERS, feeBps: 200, participants: eggsWithReferences() },
  });
  expect(res.body.participants.find((p: any) => p.reference === 'kafe')).toMatchObject({
    outcome: 'dropped_price_limit',
    refundSen: 12330,
  });
});
it('lists every bad field with a 422', async () => {
  const res = await callRoute('POST', '/api/engine/v1/quote', {
    body: {
      tiers: [
        { minQuantity: 20, unitPriceSen: 200 },
        { minQuantity: '20', unitPriceSen: 100 },
      ],
      feeBps: 200,
    },
  });
  expect(res.status).toBe(422);
  expect(res.body.details.fields.map((f: any) => f.path)).toEqual(
    expect.arrayContaining([
      'tiers[1].minQuantity',
      'unitShippingSen',
      'quantity',
      'currentRoundTotal',
    ]),
  );
});
it('works without a database', async () => {
  setDepsForTests(null);
  const res = await callRoute('POST', '/api/engine/v1/allocate-shortfall', {
    body: shortfallExample(),
  });
  expect(res.body.allocations.at(-1)).toMatchObject({
    reference: 'kedai',
    missing: 5,
    refundSen: 75925,
  });
});
```

- [ ] **Step 2:** Run `pnpm test:api -- engine-api`. Expected: FAIL.
- [ ] **Step 3: Implement** the schemas and handlers. The handlers use `route({ auth: 'public' })` and never call `getDeps()`. The same-origin check (added in M2) skips `/api/engine/v1/*`; M2 must keep this exemption.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Write `docs/engine-api.md`.** It covers:
  - purpose and versioning
  - the `X-Orbyte-App-Id` header
  - for each endpoint, the request and response JSON, taken from the three test examples
  - the 422 shape
  - "No data is stored"
- [ ] **Step 6: Commit:** `feat(api): expose the stateless Kongsi Engine API v1`

---

### Milestone verification

- [ ] Run `pnpm verify` and `FC_NUM_RUNS=5000 pnpm test:engine`. Expected: all pass.
- [ ] Merge to `main` with `--ff-only` and post the milestone report. It covers stories 158, 159, 174, 175, 178 and 180.
