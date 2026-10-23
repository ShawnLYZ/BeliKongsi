# M9 Savings, Demo and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners see honest savings, estimated until goods are checked and verified after, on a home screen that sums up their week. The demo has a full previous week of history and resets in under 10 seconds. Every screen has its empty, error and loading states, meets the accessibility rules and carries the honesty labels.

**Architecture:**

- The savings module computes per-participation and monthly figures from participations, allocations and checks through the engine's `participationSavings`.
- `seedHistoryWeek` runs before `seedCurrentWeek`, replaying week 44 end to end through the real services.
- The polish tasks are audits with explicit checklists, verified in the browser.

**Tech Stack:** the M1 engine, the M2–M8 services, Chrome DevTools MCP (screenshots, Lighthouse).

**Spec:** PRD §6.10, §20 (savings), §22 (owner home, savings, UX rules, honesty labels, performance targets), §23 (history, demo controls, demo script), §27, stories 10, 67, 82, 84–87, 171; build design C8, C12; index §5.1, §5.7.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §6.10:
  - baseline = the usual price frozen when joining, or the buy-alone price flagged "estimated vs buying alone"
  - unit saving = baseline − final all-in, and may be negative
  - estimated = unit saving × allocated
  - verified = unit saving × (allocated − missing − damaged)
  - monthly = verified savings for checks submitted in the month − delivery fees for pickups checked in that month
- PRD §27: % saved = verified savings ÷ (usual price × units).
- PRD §22: "Estimated" on savings until verified; empty states explain what will appear, with an example; errors say what happened and what to do next; loading uses skeletons; the owner home is usable in under 2 seconds on a mid-range phone over 4G.
- PRD §28: "Reset demo data" finishes in under 10 seconds.
- Months are calendar months in Malaysia time.

## Review Focus

1. **A shop with nothing checked this month:** the savings card shows "RM 0.00 verified" plus the estimated figure labelled "Estimated", never a blank or `NaN`. Pinned in Task 1.
2. **A buy-alone baseline with a negative saving:** it's shown as negative, labelled "estimated vs buying alone". Pinned in Task 1.
3. **A check at 23:30 MYT on 30 November:** it counts in November, not December. Pinned in Task 1.
4. **A reset while an owner has a checkout open:** the old checkout link answers 404 with a friendly message, not a crash. Pinned in Task 2.
5. **Gerai Contoh's delivery fee:** it's subtracted only in the month its door pickup was checked. Pinned in Task 1.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m09-savings-demo-polish`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names:
  - M1: `participationSavings`.
  - M4–M8: `seedCurrentWeek`, `listShopParticipations`, `submitDeliveryCheck`, `completeOtherRounds`, `resetDemo`, `getDemoState`.
  - M2: `subjectTimeline`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Savings

**Files:**

- Create: `src/server/modules/savings/savings.ts`, `src/lib/views/savings.ts`, `src/app/api/shops/[shopId]/savings/route.ts`
- Modify: `src/server/modules/payments/participations.ts` and `src/lib/views/participations.ts` (where `ParticipationView` is defined). `ParticipationView` gains `deliveryResult: { received: number; missing: number; damaged: number } | null` and `savings: { savingSen: number; unitSavingSen: number; status: 'estimated' | 'verified'; basis: 'usual_price' | 'buy_alone' } | null`.
- Test: `tests/api/savings.test.ts`

**Interfaces:**

- Produces:
  - `participationSavingsView(p: ParticipationWithAllocationAndCheck): SavingsView | null`. It returns `null` before cut-off and for refunded participations.
  - `monthlySavings(deps, caller, shopId, month: string /* YYYY-MM */): Promise<MonthlySavingsView>`:
    - `MonthlySavingsView = { month; roundsJoined; unitsBought; refundsSen; feesPaidSen; deliveryFeesSen; verifiedSavingsSen; estimatedSavingsSen; percentSaved: number | null; items: { participationId; productName; status; basis; savingSen }[] }`.
    - `roundsJoined` and `unitsBought` count participations kept in rounds that closed in the month.
    - `feesPaidSen` = Σ allocated × `finalFeeSen` for allocations whose round reached the hub in the month.
    - `verifiedSavingsSen` follows PRD §6.10.
    - `percentSaved` counts only usual-price baselines; it is `null` when there are none.
  - `homeSummary(deps, caller, shopId): Promise<{ basket: OwnerBasketView | null; nextPickup: PickupView | null; savingsThisMonth: { verifiedSen: number; estimatedSen: number }; balanceSen: number; pendingApprovals: number }>`.
  - `GET /api/shops/{shopId}/savings?month=YYYY-MM` (owner).

- [ ] **Step 1: Write the failing tests** (full demo flow to the approved claim, from M8's lifecycle helpers):

```ts
it('verifies RM 65.75 on condensed milk after 1 damaged carton (stories 82, 85)', async () => {
  const items = (await ah.get(`/api/shops/${KEDAI}/participations?status=history`)).body.items;
  expect(items.find((i: any) => i.shortName === 'condensed milk').savings).toEqual({
    savingSen: 6575,
    unitSavingSen: 1315,
    status: 'verified',
    basis: 'usual_price',
  });
});
it('labels a buy-alone baseline and shows negative savings honestly (story 86)', async () => {
  // EM added by Rahim has no usual price → basis 'buy_alone'; a participation with baseline 15000 and final 15185 → savingSen negative
});
it('shows estimated savings before the check', async () => {
  /* before Rahim's check: CM savings { status: 'estimated', savingSen: 1315 × 6 } */
});
it('sums the month and subtracts delivery fees for pickups checked that month (story 87)', async () => {
  const m = (await (await app.as('siti')).get(`/api/shops/${GERAI}/savings?month=2026-11`)).body;
  expect(m.deliveryFeesSen).toBe(1200); // W44 door pickup checked Sun 1 Nov (history week)
  expect(m.verifiedSavingsSen).toBe(sumVerified(m.items) - 1200);
});
it('counts a check at 23:30 MYT on 30 November in November', async () => {
  /* submit at 2026-11-30T15:30:00Z → in month 2026-11, not 2026-12 */
});
it('shows zero verified savings, not blanks, when nothing is checked yet', async () => {
  /* new month → verifiedSavingsSen 0, percentSaved null */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS. Note: the Gerai test depends on Task 2's history week. Write it here, mark it `it.todo` until Task 2, then enable it.
- [ ] **Step 5: Commit:** `feat(savings): estimated and verified savings with monthly figures`

---

### Task 2: The history week, and resetting in under 10 seconds

**Files:**

- Create: `prisma/seed/history-week.ts`
- Modify:
  - `prisma/seed/index.ts`: `seedHistoryWeek`, then `seedCurrentWeek`.
  - `prisma/seed/current-week.ts`: step 1 becomes `openDueRounds` (open only products without an open round), because the week-44 close already opened the week-45 weekly rounds.
  - `src/app/checkout/[paymentId]/page.tsx`: a friendly 404 ("This payment no longer exists. The demo may have been reset.").
- Test: `tests/api/seed-history.test.ts`

**Interfaces:**

- Produces: `seedHistoryWeek(ctx: TxContext, anchorMonday: Date): Promise<void>` (same shape as `seedCurrentWeek`: runs inside the seed transaction and moves time with `setTransactionNow`). The index §5.1 time line, relative to the anchor:
  - **Thu 22 Oct 20:00:** `openDueRounds` (week-44 weekly rounds, and week-45 packaging rounds).
  - **Fri 23 Oct 09:00 onwards:** background joins on weekly products only, using the index §5.7 weekly quantity lists and the same assignment rule, 45 minutes apart.
  - **Mon 26 Oct 06:00:** draft baskets. Gerai's covers `CM` 4, `EM` 2 and `FLOUR` 2; Kafe's covers `CM` 3, `EGG_B` 10 and `COFFEE` 2. Gerai pays at 06:01, Kafe at 06:03.
  - **Thu 29 Oct 20:00:** `closeDueRounds`. This also opens the week-45 weekly rounds.
  - **Fri 30 Oct:** 09:00 Ops approves every formed order; 11:00 suppliers confirm (dispatch date = required date); 15:00 dispatched.
  - **Sat 31 Oct:** 10:00 hub checks, all good; 14:00 consignments dispatched.
  - **Sun 1 Nov:** 10:00 arrived or delivered (background pickups close automatically); 12:00 Kumar and Danial collect; 12:05 "All received".

- [ ] **Step 1: Write the failing tests:**

```ts
it('has a completed previous week for Gerai, Kafe and the background shops', async () => {
  expect(
    await app.prisma.round.count({
      where: { cycleLabel: '2026-W44', status: { in: ['completed', 'failed'] } },
    }),
  ).toBe(8);
  expect((await participationsOf('GERAI', '2026-W44')).every((p) => p.status === 'closed')).toBe(
    true,
  );
});
it('leaves the demo week on its designed totals', async () => {
  expect(await totalsByProductKey(app)).toEqual({
    CM: 99,
    EM: 57,
    OIL: 104,
    FLOUR: 25,
    COFFEE: 29,
    TEA: 6,
    EGG_A: 320,
    EGG_B: 130,
    CUPS: 29,
    CONT: 15,
    BAGS: 51,
    KRAFT: 0,
  });
});
it('resets in under 10 seconds with a valid log and balanced books (story 166)', async () => {
  const t0 = performance.now();
  await (await app.as('nadia')).post('/api/demo/reset');
  const ms = performance.now() - t0;
  expect(ms).toBeLessThan(10_000);
  expect((await verifyLogChain(app.prisma)).valid).toBe(true);
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
});
it('answers an old checkout link with 404 after a reset', async () => {
  /* GET /api/payments/<old id> → 404 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. If the reset takes ≥ 10 s, profile it and apply C8's fallback: write the history week's rows in bulk through the same builders and engine, inside the same transaction, keeping one log entry per business action. **Step 4:** Run. Expected: PASS. Enable Task 1's Gerai test.
- [ ] **Step 5: Commit:** `feat(seed): add a completed history week; reset under 10 seconds`

---

### Task 3: Owner home, My Kongsi history, savings page and timelines

**Files:**

- Create: `src/app/(shell)/owner/savings/page.tsx`, `src/components/home/*`, `src/components/common/timeline-sheet.tsx`
- Modify: `src/app/(shell)/owner/page.tsx`, `src/app/(shell)/owner/kongsi/page.tsx`, `src/app/(shell)/owner/basket/page.tsx`, `src/app/(shell)/owner/pickups/[pickupId]/page.tsx`, `src/app/(shell)/owner/claims/[claimId]/page.tsx`

- [ ] **Step 1: The owner home** (PRD §22). It shows:
  - the basket card: status, amount now, about after cut-off, estimated savings, countdown, "Approve & pay"
  - the next pickup card: place, date, code
  - savings this month, as verified figures plus a small "Estimated" figure
  - the balance
  - pending approvals
  - Use the `homeSummary` API, and call `scheduleDueWork`.
- [ ] **Step 2: My Kongsi history.** Each card gets its final price, refund, delivery result and verified savings (story 67).
- [ ] **Step 3: The savings page.** The month's figures with a month switcher, % saved, and per-round rows with the basis label.
- [ ] **Step 4: Timelines.** A "Timeline" sheet on the basket, participation, pickup and claim screens, using `GET /api/activity?subjectType&subjectId`, with the log verification result shown (PRD §14).
- [ ] **Step 5: Verify** with Chrome DevTools after `pnpm db:reset` and the demo flow to the approved claim. Expected: the home screen shows "RM 65.75" verified savings for condensed milk on the savings page, and the condensed milk timeline lists every step from "joined" to "claim approved".
- [ ] **Step 6: Commit:** `feat(ui): owner home, savings and timelines`

---

### Task 4: States, accessibility and honesty labels

**Files:**

- Modify: any screen that fails the checklists below.

- [ ] **Step 1: Empty, error and loading states** (stories 10, PRD §22). Every page in `src/app/(shell)/**` and `/checkout` must have:
  - an empty state that says what will appear, with an example
  - errors from `apiFetch` that say what happened and what to do next
  - a skeleton while loading (`loading.tsx` per route group)
- [ ] **Step 2: Accessibility (G9).**
  - Run Chrome DevTools `lighthouse_audit` (category accessibility) on these pages at 390 × 844: `/owner`, `/owner/basket`, `/owner/setup`, `/staff`, `/staff/deliveries/<id>`, `/checkout/<id>`, `/supplier`. Run `/ops` at 1280 × 800.
  - Expected: a score of at least 95 for each.
  - Also check tap targets ≥ 44 px, body text ≥ 16 px, `tabular-nums` on amounts, visible focus and labelled inputs.
- [ ] **Step 3: Honesty labels.** Grep and click through for:
  - "Simulated" on every payment, payout and partner screen
  - "AI-generated image" under every product picture
  - "Estimated" on savings until verified
  - the "Made-up data" banner on every shell page in demo mode
  - no "KongsiBeli", "BeliBijak" or "LeakCatch" anywhere (`pnpm exec rg -n "KongsiBeli|BeliBijak|LeakCatch" src docs/engine-api.md README.md` must print nothing)
- [ ] **Step 4: Performance.** In a production build (`pnpm build && pnpm start`), the owner home reaches Largest Contentful Paint in under 2 seconds with Chrome DevTools throttling set to "Fast 4G" and 4× CPU slowdown. Fix any regression with server-side rendering and fewer queries.
- [ ] **Step 5:** Run `pnpm verify`. Expected: PASS.
- [ ] **Step 6: Commit:** `fix(ui): states, accessibility and honesty labels across all screens`

---

### Task 5: Demo rehearsal

**Files:**

- Modify: `src/components/shell/demo-menu.tsx` and `src/server/modules/demo/demo.ts`, plus any screen the rehearsal finds blocking a step. List each such fix in the milestone report.

- [ ] **Step 1: The demo menu.** It has the role switcher (every seeded account), "Skip to cut-off", "Complete other rounds" and "Reset demo data", plus "Use saved example" in setup when the AI fails. The banner stays visible in every role.
- [ ] **Step 2: Rehearse PRD §23's 4-minute script** in a production build with the real Gemini model (`AI_ADAPTER=gemini`). Record the time per step and every amount seen:
  - RM 984.54 paid on condensed milk
  - RM 73.44 refunded
  - RM 123.30 refunded to Kafe Contoh
  - RM 15,330.00 supplier order
  - RM 151.85 claim refund
  - RM 65.75 verified savings
  - "Verify log" ✅ and the money overview ✅
- [ ] **Step 3:** Fix anything that blocks the script or takes more than one tap where the script expects one. Then commit: `fix(demo): smooth the demo script`

---

### Milestone verification

- [ ] Run `pnpm verify`, then `pnpm db:reset` and the Task 5 rehearsal.
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 10, 67, 82, 84–87, 171), with the rehearsal timings, Lighthouse scores and reset time.
