# M4 Weekly Basket and Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Monday at 06:00 each shop gets a ready-to-pay basket from its usual list. Staff can add to it, and the owner approves and pays in one action on a simulated DuitNow QR or FPX screen. The BeliKongsi balance is used first, every ringgit is posted to the ledger, and owners can also join rounds from the catalogue and cancel before cut-off. The seeded demo week is built through these same services.

**Architecture:** The baskets module drafts and edits baskets. The payments module owns `createPayment` → `completePaymentSuccess` / `failPayment` and is the only code that creates participations or money-in postings. Jobs (`runDueJobs`) run from a protected endpoint, from Vercel Cron, and as "due work" after page loads. `seedCurrentWeek` replays the demo week through the real services under a seed clock.

**Tech Stack:** Prisma 7 interactive transactions, Next.js `after()` (from `next/server`), shadcn/ui. Only `button`, `card` and `sonner` exist in `src/components/ui` today, so Task 8 adds `sheet` and `tabs` with the shadcn CLI; toasts use the existing `sonner`.

**Spec:** PRD §7 (calendar, jobs), §8 (approve and pay, postings, receipts, money history), §12 (weekly basket approval), §13 (basket and payment notices), §20 (weekly basket; payments and balance; rounds participations and cancel; jobs), §22 (weekly basket, checkout, money, staff), stories 9, 27–39, 46, 47, 52–58, 95–98, 102, 146; build design C5, C11, R10, R11; index §5.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §8 "Approve and pay": re-quote every line and remove lines whose round has closed, with a notice; the total is at starting prices plus any delivery fee; apply the balance first; a zero external amount succeeds immediately; on success, create participations (`joinedAt` = success time) and post partner cash → round hold per line, shop balance → round hold for the balance used, and the delivery fee into the delivery fee hold; on failure, return to draft with no postings; a result after the deadline voids the payment.
- PRD §6.9: one delivery fee per shop per door delivery date, charged with the first payment that includes a door line for that date, and never split across lines.
- PRD §8 receipt: every line (product, quantity, starting all-in price, fee and shipping share), any delivery fee, the balance used and the amount paid, and "Issued by BeliKongsi (simulated). Not a tax invoice."
- PRD §22 checkout: a "Simulated payment — no real money moves" banner; "DuitNow QR" (placeholder QR) or "FPX online banking" (fictional banks); "Pay (simulated)" and "Simulate failure"; method names as plain text with no real logos or bank branding.
- PRD §7 reminders: 24 hours and 3 hours before the basket deadline, only to owners who haven't decided.
- Staff may only change quantities and add items (PRD §4, §15).

## Review Focus

1. **"Approve & pay" tapped twice:** one payment, and the second tap gets the same pending payment back. Pinned in Task 3.
2. **A simulated payment result after the deadline:** the payment is voided, with no participations and no postings. Pinned in Task 3.
3. **A balance that covers part, or all, of a basket:** postings split per line exactly, the balance never goes negative, and full cover skips the checkout. Pinned in Task 3.
4. **Staff adding a fortnightly product in a week its round doesn't close:** the line goes to the basket for the week its round closes, and is never lost (story 98). Pinned in Task 2.
5. **A basket payment and a catalogue join both with door lines for the same delivery date:** only the first is charged the delivery fee. Pinned in Task 4.

**Test setup used by Tasks 1–4.**

- `createTestApp({ seed: 'reference' })`: Gerai and Kafe already have usual lists, and nobody has joined any round.
- `openDueRounds` runs at the anchor, so every round closes Thu 5 Nov 20:00.
- `setupKedaiKopi(app)`, in `tests/api/helpers/scenarios.ts`, saves Kedai Kopi's usual list from the sample order (`CM` 6, `OIL` 2, `EGG_A` 10, `COFFEE` 1, `CUPS` 2, at the sample prices) with the Ipoh pickup point.
- From Task 5 on, `seed: 'demo'` adds the seeded week.
- The default test clock is Mon 2 Nov 06:05 MYT (`2026-11-01T22:05:00Z`) and it is also the seed anchor. Tests that set the clock to 06:00 or 06:10 move it by hand; `openDueRounds` stamps `opensAt` with whatever the clock says when it runs.
- Seed shops: Kedai Kopi Contoh (`KEDAI_KOPI`, pickup Ipoh, `setupCompletedAt` null), Gerai (`GERAI`, door), Kafe (`KAFE`, pickup Kuantan). Seed users: `ahSeng`/`rahim` (Kedai owner/staff), `siti`/`kumar` (Gerai), `mei`/`danial` (Kafe), `nadia` (Ops). Background shops are `BG01` to `BG40`.
- Existing M2/M3 tests that use the default `seed: 'demo'` (`catalogue-rounds`, `usual-list`, `usual-list-parse`, `settings`, `session`, `shell-api`, `demo-reset`) must still pass after each task. Task 1 adds a `basket.drafted` log entry and a notification when a usual list is saved, and Task 5 puts participations into the seeded rounds (`catalogue-rounds.test.ts` line 80 expects `totalQuantity: 0`). Fix their expectations in the task that changes them.

## Code as built (confirmed in Task 0)

M4 uses these exactly as they exist; do not invent other signatures.

- `TxContext = { tx, now: Date, caller, actor, deps }`; `withTransaction(deps, caller, fn, { timeoutMs? })`. An inner call joins the outer transaction and reuses its `now`. Reads made with `deps.prisma` do not see the transaction's uncommitted rows, so every service the seed calls reads through `ctx.tx` and uses `ctx.now`.
- `post(ctx, { from, to, amountSen, kind, refs?: { roundId?, participationId?, paymentId?, shopId?, … }, memo? })`. It throws `RangeError` for an amount of 0 or less, so never post a zero split. `balanceOf(db, ref)`. Account refs: `shop_balance {shopId}`, `round_hold {roundId}`, `delivery_fee_hold {shopId, deliveryDate}`, `partner_cash`. `shop_balance`, `round_hold` and `delivery_fee_hold` may not go negative.
- `createApproval(ctx, { type, subjectType, subjectId, shopId?, assigneeRole, amountSen?, summary, whyNeeded, evidence, expiresAt? }): Promise<{ id }>`. It creates the request as `pending`; for `weekly_basket` the basket code later sets `ApprovalRequest.status`, `decidedByUserId` and `decidedAt` itself. `decideApproval` throws a plain `Error` when no handler is registered for the type, so Task 3 registers a `weekly_basket` handler whose `onApprove` throws 422 `USE_BASKET_SCREEN` and whose `onReject` calls the skip logic (the inbox hides both buttons for baskets, but the API route is open).
- `notify(ctx, { type, audience: { shopId?, roles, userIds? }, link, message: (role) => { title, body, whatsappText }, dedupeKey? })`. `TEMPLATES` is built by `defineTemplates({ type: (data) => (role) => message })` and is empty today, so M4 adds `basket.ready`, `basket.staff_added`, `payment.succeeded`, `payment.failed`, `participation.cancelled` and `basket.reminder`. A message is at most 300 characters, and staff messages may not contain `RM <digit>`.
- `emitEvent(ctx, type, data)`: `type` must be one of the PRD §21 `EventType`s (all M4 types exist). Data keys may not match `name|phone|email|address`.
- `appendLog(ctx, { action, subjectType, subjectId, scope: { shopId?, supplierId?, operator? }, before?, after?, reason? })`: `action` must be in the PRD §14 `ACTIONS` list (every M4 action exists).
- `route({ auth, body?, query?, idempotent? }, handler)` with `auth` `'public' | 'session' | Role[]`; `idempotent` needs a non-public auth. Mutating requests under `/api/jobs/` skip the origin check.
- `priceForShop(deps, round /* with hub */, shop /* with defaultPickupPoint */, { destination?, quantity, total, priceLimitSen?, unitName }): Promise<ShopQuote>` and `activeTotals(db, roundId)`. `quoteForShop(deps, caller, roundId, …)` needs a person caller with a shop membership and an open round (422 `ROUND_NOT_OPEN`), so `createPayment` uses `priceForShop`, not `quoteForShop`.
- `DestinationInput = { type: 'pickup_point'; pickupPointId } | { type: 'door' }`. `defaultDestination(shop, points)`. `nextCutoffAfter(product, instant)` is strictly after `instant`. `deliveryDateOf(cutoff): 'YYYY-MM-DD'`.
- `roundProgress(db, roundId): { totalQuantity, shopCount, currentTier, unitsToNextTier, nextTierUnitPriceSen }`.
- `isoWeekOf(d)`, `isoWeekStart(week)`, `addIsoWeeks(week, n)`, `mytDate(d)` in `@/lib/time`; `formatRM`, `formatUnits(q, unitName)`, `formatMytShort`, `formatMytDate` in `@/lib/format`.
- Schema today: `WeeklyBasket` has `firstOpenedAt`, `approvalRequestId`, `approvedAt`, `approvedByUserId`, `skipReason`, `deadlineAt`, `fulfilment` but no `draftedAt`; `BasketLine.roundId` is required and `removed` has no default; `DeliveryFeeCharge` is unique on `(shopId, deliveryDate)` and has no relation to `Payment`; `Participation.paymentLineId` is unique.

---

### Task 0: Re-sync

- [x] **Step 1:** `git switch -c m04-weekly-basket-and-payments`
- [x] **Step 2:** Follow index §6. Confirm the consumed names (done; see "Code as built" above):
  - M2: `post`, `balanceOf`, `runMoneyChecks`, `createApproval`, `notify`, `TEMPLATES`, `emitEvent`, `appendLog`, `withIdempotency`, `route` with `idempotent`.
  - M3: `quoteForShop`, `DestinationInput`, `openNextRound`, `openDueRounds`, `nextCutoffAfter`, `deliveryDateOf`, `simulatedLogistics`, `saveUsualList`, `updateShopSettings`, `roundProgress`, the temporary seed phase `openRoundsAtAnchor`.
  - M1: `quote`, `unitAmounts`, `participationSavings`.
- [x] **Step 3:** Commit any plan edits.

---

### Task 1: Drafting weekly baskets

**Files:**

- Create: `prisma/migrations/<timestamp>_basket_drafting/migration.sql`, `src/server/modules/baskets/draft.ts`, `src/server/modules/baskets/amounts.ts`, `tests/api/helpers/scenarios.ts`
- Modify:
  - `prisma/schema.prisma`: `WeeklyBasket.draftedAt DateTime?`; `BasketLine.roundId` becomes optional (set once the line's round is known).
  - `src/server/modules/usual-list/usual-list.ts`: `saveUsualList` drafts this week's basket if none exists (PRD §20).
  - `src/server/modules/notifications/templates.ts`: `basket.ready`.
- Test: `tests/api/baskets-draft.test.ts`

**Interfaces:**

- Produces:
  - `draftBasketForShop(ctx: TxContext, shopId: string, basketWeek: string): Promise<{ basketId: string | null; created: boolean }>`.
    - Lines come from usual-list items whose product's open round has `isoWeekOf(cutoffAt) === basketWeek`. Each line gets quantity, `priceLimitSen`, `source 'usual_list'` and `roundId`.
    - Usual-list items are merged into a draft that already holds staff additions: quantity = usual quantity + `staffAddedQuantity`, and the highlight is kept (C5).
    - Staff-added lines without a round are resolved to this week's round when one exists.
    - `deadlineAt` = the earliest line cut-off; fulfilment comes from the shop's default.
    - It creates the `weekly_basket` approval (`createApproval`, assignee owner, amount = total now; the basket stores its id in `approvalRequestId`), sets `draftedAt`, logs `basket.drafted`, emits `basket.drafted { basketId, shopId, week, lineCount }` and notifies the owner with `basket.ready`.
    - With no lines it returns `{ basketId: null }` and creates nothing.
  - `draftWeeklyBaskets(deps, opts?: { shopIds?: string[] }): Promise<{ drafted: number }>`.
    - It runs only once `now ≥ isoWeekStart(week) + 6 h` (Monday 06:00 MYT), unless `shopIds` is given (the setup trigger).
    - It skips baskets already drafted, paid, skipped or expired.
    - Background shops are excluded.
  - `basketTotals(db, basketId, at: Date): Promise<BasketTotals>`:

```ts
type BasketTotals = {
  itemsAtStartingSen: number;
  feeIncludedSen: number;
  deliveryFeeSen: number;
  totalNowSen: number;
  balanceAvailableSen: number;
  balanceAppliedSen: number;
  payNowSen: number;
  estimatedAfterCutoffSen: number;
  estimatedSavingsSen: number;
  savingsHasBuyAloneBasis: boolean;
};
```

- `setupKedaiKopi(app: TestApp): Promise<{ shopId: string }>` (test helper).
- `TEMPLATES['basket.ready']` owner text: `Your Kongsi basket for this week is ready: {n} items, {RM now} now, about {RM after} after cut-off. Approve by {formatMytShort(deadline)}.`

- [ ] **Step 1: Write the failing tests:**

```ts
it('drafts a basket for each shop with a usual list on Monday at 06:00 (story 27)', async () => {
  app.clock.set('2026-11-01T22:00:00Z'); // Mon 06:00 MYT
  expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 2 }); // Gerai, Kafe
  const gerai = await basketOf('GERAI', '2026-W45');
  expect(gerai).toMatchObject({
    status: 'draft',
    deadlineAt: new Date('2026-11-05T12:00:00Z'),
    fulfilment: 'door',
  });
  expect(gerai.lines.map((l) => [l.productKey, l.quantity])).toEqual([
    ['CM', 4],
    ['EM', 2],
    ['FLOUR', 2],
    ['CONT', 3],
  ]);
});
it('does nothing before Monday 06:00 or when run twice', async () => {
  app.clock.set('2026-11-01T21:59:00Z');
  expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 0 });
  app.clock.set('2026-11-01T22:00:00Z');
  await draftWeeklyBaskets(app.deps);
  expect(await draftWeeklyBaskets(app.deps)).toEqual({ drafted: 0 });
});
it('leaves out products whose round does not close this week (story 28)', async () => {
  /* move the CUPS anchor to W44 before opening rounds → Kafe's basket has no CUPS line */
});
it('tells the owner the amount now and the estimate', async () => {
  const n = await app.prisma.notification.findFirstOrThrow({
    where: { type: 'basket.ready', userId: seedId('user', 'mei') },
  });
  expect(n.whatsappText).toMatch(
    /^Your Kongsi basket for this week is ready: 4 items, RM [\d,.]+ now, about RM [\d,.]+ after cut-off\. Approve by Thu 8 pm\.$/,
  );
});
it('drafts this week’s basket as soon as setup saves the usual list (story 9)', async () => {
  app.clock.set('2026-11-01T22:10:00Z');
  await setupKedaiKopi(app);
  expect((await basketOf('KEDAI_KOPI', '2026-W45')).status).toBe('draft');
});
```

- [ ] **Step 2:** Run. **Step 3:** Write the migration (it ends with `SELECT bk_secure_all_tables();`), then implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(baskets): draft weekly baskets from usual lists`

---

### Task 2: Viewing and editing the basket

**Files:**

- Create:
  - Module: `src/server/modules/baskets/basket.ts`
  - Shared types: `src/lib/views/baskets.ts`
  - Routes: `src/app/api/shops/[shopId]/baskets/current/route.ts`, `src/app/api/baskets/[basketId]/lines/route.ts`, `src/app/api/baskets/[basketId]/lines/[lineId]/route.ts`, `src/app/api/baskets/[basketId]/fulfilment/route.ts`
- Modify: `src/server/modules/notifications/templates.ts` (`basket.staff_added`)
- Test: `tests/api/baskets-edit.test.ts`

**Interfaces:**

- Produces:
  - `getCurrentBasket(deps, caller, shopId): Promise<OwnerBasketView | StaffBasketView | null>`. An owner's first view sets `firstOpenedAt` (C11).
  - `OwnerBasketView`:
    - `{ basketId; week; status; deadlineAt; fulfilment; pickupPoint: PickupPointView | null; lines: OwnerBasketLine[]; totals: BasketTotals; approvalRequestId }`
    - `OwnerBasketLine = { lineId; productId; name; shortName; packDescription; unitName; imageUrl; quantity; priceLimitSen: number | null; usualPriceSen: number | null; source; changedBy: { name: string; role: Role } | null; staffAddedQuantity; removed; notice: string | null; roundId: string | null; cutoffAt: string | null; startingAllInSen; startingLineSen; projectedAllInSen: number | null; estimatedSavingsSen: number | null; savingsBasis: 'usual_price' | 'buy_alone'; explanation: string[] }`
  - `StaffBasketView`:
    - `{ basketId; week; status; lines: { lineId; productId; name; packDescription; unitName; imageUrl; quantity; waitingForOwner: boolean; addedByMe: boolean }[] }`
    - It has no money fields (R6).
  - `addBasketLine(deps, caller, basketId, { productId, quantity }): Promise<{ basketId: string; week: string; routedToNextWeek: boolean }>` (owner or staff). Routing:
    - If the basket is a draft and the product's open round closes in its week, the line goes into this basket; an existing line's quantity is raised.
    - Otherwise it goes into the draft for `isoWeekOf(the product's open round cut-off)` when that's later than this week, else into next week's draft, with `roundId` null until drafting.
    - Staff additions set `staffAddedQuantity` and `changedBy*`, log `basket.line_added_by_staff`, and notify the owner with `basket.staff_added`.
  - `changeBasketLine(deps, caller, basketId, lineId, { quantity?: number; priceLimitSen?: number | null; removed?: boolean })`. Staff may send only `quantity`, otherwise 403. It logs `basket.line_changed` with before and after.
  - `setBasketFulfilment(deps, caller, basketId, input: { fulfilment: 'pickup'; pickupPointId: string } | { fulfilment: 'door' })`. Owner only; a basket that's too far for door delivery gets 422 `DOOR_TOO_FAR`. It logs `basket.fulfilment_changed`.
  - `TEMPLATES['basket.staff_added']` owner text: `{Staff name} added {formatUnits(q, unit)} of {shortName} to {this|next} week's basket.`

- [ ] **Step 1: Write the failing tests** (Monday 06:10, Kedai Kopi set up, so its basket is drafted; Gerai and Kafe drafted too):

```ts
it('raises the quantity and highlights a staff addition (story 33, C5)', async () => {
  await (
    await app.as('rahim')
  ).post(`/api/baskets/${kedaiBasket}/lines`, { productId: seedId('product', 'EM'), quantity: 1 });
  const v = (await (await app.as('ahSeng')).get(`/api/shops/${KEDAI}/baskets/current`)).body;
  expect(v.lines.find((l: any) => l.shortName === 'evaporated milk')).toMatchObject({
    quantity: 1,
    staffAddedQuantity: 1,
    changedBy: { name: 'Rahim', role: 'staff' },
  });
  expect(
    (await app.prisma.notification.findFirstOrThrow({ where: { type: 'basket.staff_added' } }))
      .whatsappText,
  ).toBe("Rahim added 1 carton of evaporated milk to this week's basket.");
});
it('sends staff additions after payment to next week’s basket (story 98)', async () => {
  /* pay Kedai's basket (Task 3 helper); rahim adds CM 2 → routedToNextWeek true; W46 draft holds CM with roundId null */
});
it('sends a fortnightly product to the week its round closes', async () => {
  /* CUPS anchored W46 → rahim adds CUPS → week '2026-W46' */
});
it('lets staff change quantities but not limits, removals or fulfilment (story 102)', async () => {
  const r = await app.as('rahim');
  expect((await r.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, { quantity: 3 })).status).toBe(
    200,
  );
  expect(
    (await r.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, { priceLimitSen: 1 })).status,
  ).toBe(403);
  expect(
    (await r.patch(`/api/baskets/${kedaiBasket}/lines/${line}`, { removed: true })).status,
  ).toBe(403);
  expect(
    (await r.patch(`/api/baskets/${kedaiBasket}/fulfilment`, { fulfilment: 'door' })).status,
  ).toBe(403);
});
it('shows staff the basket without any money (story 99)', async () =>
  expectNoMoneyFields(
    (await (await app.as('rahim')).get(`/api/shops/${KEDAI}/baskets/current`)).body,
  ));
it('shows the owner starting and projected prices and estimated savings (stories 29–31)', async () => {
  // insert participations totalling 99 CM cartons from other shops first (builder), so the round is at tier 2
  const cm = (
    await (await app.as('ahSeng')).get(`/api/shops/${KEDAI}/baskets/current`)
  ).body.lines.find((l: any) => l.shortName === 'condensed milk');
  expect(cm).toMatchObject({
    quantity: 6,
    startingAllInSen: 16409,
    startingLineSen: 98454,
    projectedAllInSen: 15185,
    estimatedSavingsSen: (16500 - 15185) * 6,
    savingsBasis: 'usual_price',
  });
  expect(cm.explanation).toContain('99 cartons so far. 1 more carton and everyone pays RM 146.00.');
});
it('records when the owner first opens the basket (C11)', async () => {
  /* firstOpenedAt set on the first owner GET, unchanged on the second */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(baskets): view and edit baskets by role`

---

### Task 3: Approve and pay

**Files:**

- Create:
  - Adapter: `src/server/adapters/payments.ts`
  - Payments module: `src/server/modules/payments/create.ts`, `src/server/modules/payments/complete.ts`, `src/server/modules/payments/simulate.ts`
  - Basket approval: `src/server/modules/baskets/approve.ts`
  - Routes: `src/app/api/baskets/[basketId]/approve/route.ts`, `src/app/api/payments/[paymentId]/simulate/route.ts`
- Modify: `src/server/platform/deps.ts` (`AppDeps.payments`, set in `getDeps`), `tests/api/helpers/app.ts` (`createTestDeps` builds the `AppDeps` literal, so it gets `payments: simulatedPayments`), `src/server/modules/notifications/templates.ts` (`payment.succeeded`, `payment.failed`), `tests/api/helpers/scenarios.ts` (`payBasket(app, userKey, basketId)`), and the approvals module (register the `weekly_basket` handler described under "Code as built")
- Test: `tests/api/payments.test.ts`

**Interfaces:**

- Produces:
  - `interface PaymentsPartner { startCheckout(i: { paymentId: string; amountSen: number }): Promise<{ reference: string }>; payout(i: { supplierOrderId: string; supplierId: string; amountSen: number }): Promise<{ reference: string }> }`.
  - `simulatedPayments`: references `SIM-PAY-` and `SIM-OUT-` followed by 8 upper-case hex characters.
  - `type PaymentLineInput = { productId; roundId; basketLineId?: string; quantity; priceLimitSen: number | null; destination: DestinationInput }`.
  - `createPayment(ctx, input: { shopId; purpose: 'basket' | 'join'; basketId?: string; lines: PaymentLineInput[]; deadlineAt: Date; source: ParticipationSource; settleImmediatelyWith?: 'duitnow_qr' | 'fpx' }): Promise<PaymentSummary>`.
    - `PaymentSummary = { paymentId; status: 'pending' | 'succeeded'; linesTotalSen; deliveryFeeSen; totalSen; balanceAppliedSen; externalSen; checkoutUrl: string | null }`.
    - It prices each line with `priceForShop` (not `quoteForShop`; the seed calls it as a system caller). It writes `PaymentLine`s with starting unit amounts, shipping, baseline (usual price, otherwise buy-alone) and `deliveryDate = deliveryDateOf(round.cutoffAt)`.
    - It adds one delivery fee per door delivery date that has no held or passed charge and no other pending payment for the same date.
    - `settleImmediatelyWith` is used by the seed and by M11 AutoDebit: it completes at once without a checkout.
  - `completePaymentSuccess(ctx, paymentId, method: PaymentMethod): Promise<void>`. In one transaction:
    - **Balance first:** applied line by line, ordered by `roundId` then payment line id, and then to delivery fees.
    - **Postings:** `shop_balance → round_hold` (`balance_applied`), `partner_cash → round_hold` (`payment_in`), and `→ delivery_fee_hold` (`delivery_fee_in` or `balance_applied`).
    - **Participations** are created with status `active`.
    - **`DeliveryFeeCharge`** rows are created as `held`. The table is unique on `(shopId, deliveryDate)`, so a row left `refunded` by a cancellation is set back to `held` with the new `paymentId` instead of inserted. If a `held` or `passed_to_partner` charge already exists, the duplicate fee is refunded to the balance (`refund_delivery_fee`). Postings with an amount of 0 are skipped.
    - **The basket** becomes `paid`, and its approval `approved` by the owner.
    - **Logs:** `payment.succeeded`, `balance.applied`, `participation.joined` ×N, `basket.approved`.
    - **Events:** `basket.approved { basketId, shopId, week, lineCount, amountSen }`, and `participation.joined` ×N with `{ participationId, roundId, shopId, quantity, outcome: 'active' }`.
    - **Notification** `payment.succeeded` to the owner: `Payment received (simulated). You're in {N} Kongsi rounds this week.` For a join: `Payment received (simulated). You're in the {shortName} Kongsi.`
  - `failPayment(ctx, paymentId)`: the payment becomes `failed`, the basket goes back to `draft`, there are no postings, `payment.failed` is logged, and the owner is notified: `Payment failed (simulated). Your basket is unchanged. Tap to try again.`
  - `simulatePaymentResult(deps, caller, paymentId, { outcome: 'succeeded' | 'failed'; method: 'duitnow_qr' | 'fpx' }): Promise<PaymentView>`.
    - Owner of the payment's shop only.
    - A payment that isn't pending is returned unchanged.
    - If `now > deadlineAt`, the payment becomes `voided` and the call returns 409 `PAYMENT_VOIDED`.
  - `approveBasket(deps, caller, basketId): Promise<PaymentSummary>` (owner, idempotent route):
    - A `payment_pending` basket returns its pending payment.
    - Re-quote and remove lines whose round is no longer open, with the notice "Removed: this round closed before you paid."
    - A basket with no lines left gets 422 `BASKET_EMPTY`.

- [ ] **Step 1: Write the failing tests** (Kedai Kopi set up and drafted at Monday 06:10):

```ts
it('pays Kedai Kopi Contoh’s basket on the simulated checkout (stories 35, 52)', async () => {
  const ah = await app.as('ahSeng');
  const s = (
    await ah.post(`/api/baskets/${kedaiBasket}/approve`, undefined, { 'idempotency-key': 'k1' })
  ).body;
  expect(s).toMatchObject({
    status: 'pending',
    balanceAppliedSen: 0,
    checkoutUrl: `/checkout/${s.paymentId}`,
  });
  await ah.post(`/api/payments/${s.paymentId}/simulate`, {
    outcome: 'succeeded',
    method: 'duitnow_qr',
  });
  expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({
    quantity: 6,
    paidSen: 98454,
    startingAllInSen: 16409,
    unitShippingSen: 293,
    baselineSen: 16500,
    baselineKind: 'usual',
    status: 'active',
  });
  expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(98454);
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
});
it('returns the same pending payment when approve is tapped twice', async () => {
  /* two approvals → same paymentId; one payments row */
});
it('repeats a simulated result without new postings', async () => {
  /* simulate succeeded twice → postings count unchanged after the second */
});
it('keeps the basket unpaid after a failure and lets the owner retry (story 54)', async () => {
  // simulate failed → basket 'draft', zero postings for that payment; approve again → new payment; succeed → paid
});
it('voids a result that arrives after the deadline', async () => {
  app.clock.set('2026-11-05T12:00:01Z');
  expect(
    (await ah.post(`/api/payments/${pid}/simulate`, { outcome: 'succeeded', method: 'fpx' }))
      .status,
  ).toBe(409);
  expect(await app.prisma.participation.count({ where: { paymentId: pid } })).toBe(0);
});
it('uses the balance first and splits postings exactly (story 53)', async () => {
  // give KEDAI a balance of 50000 (partner_cash → shop_balance posting via post()) → approve → balanceAppliedSen 50000, externalSen = total − 50000; shop balance 0 afterwards; each round hold equals its line
});
it('skips the checkout when the balance covers everything', async () => {
  /* balance ≥ total → status 'succeeded', checkoutUrl null, method 'balance_only' */
});
it('removes a line whose round has closed before approval, with a notice', async () => {
  /* set the OIL round status 'formed' → approve → OIL line removed with the notice */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(payments): approve and pay with balance first and a simulated partner`

---

### Task 4: Joining from the catalogue and cancelling before cut-off

**Files:**

- Create: `src/server/modules/payments/join.ts`, `src/server/modules/payments/cancel.ts`, `src/app/api/rounds/[roundId]/participations/route.ts`, `src/app/api/participations/[id]/cancel/route.ts`
- Modify: `src/server/modules/notifications/templates.ts` (`participation.cancelled`)
- Test: `tests/api/join-cancel.test.ts`

**Interfaces:**

- Produces:
  - `joinRound(deps, caller, roundId, input: { quantity: number; priceLimitSen?: number | null; destination?: DestinationInput }, opts?: { shopId?: string; source?: ParticipationSource; settleImmediatelyWith?: 'duitnow_qr' | 'fpx' }): Promise<PaymentSummary>`.
    - Owners join for their own shop. System callers (the seed) pass `opts.shopId`.
    - The round must be open, with `now < cutoffAt`; otherwise 409 `ROUND_CLOSED`.
    - The payment deadline is the round's cut-off.
  - `cancelParticipation(deps, caller, participationId): Promise<{ refundSen: number; deliveryFeeRefundSen: number }>` (owner):
    - The participation must be active and before cut-off; otherwise 409 `ROUND_CLOSED`.
    - It posts `round_hold → shop_balance` (`refund_cancelled`) for the full `paidSen`.
    - The delivery fee is also refunded when no active door participations remain for that date: the `held` `DeliveryFeeCharge` becomes `refunded` and the posting is `delivery_fee_hold → shop_balance` (`refund_delivery_fee`).
    - It logs `participation.cancelled` and `refund.issued`, and emits `participation.cancelled` and `refund.issued { shopId, amountSen, kind: 'full' | 'delivery_fee', referenceId }`.
    - It notifies the owner: `Cancelled: {units} of {shortName}. {RM refund} is back in your balance.`

- [ ] **Step 1: Write the failing tests:**

```ts
it('joins a round from the catalogue at the starting price (story 46)', async () => {
  const s = (
    await (await app.as('mei')).post(`/api/rounds/${cmRound}/participations`, { quantity: 2 })
  ).body;
  expect(s).toMatchObject({ linesTotalSen: 2 * 16545, status: 'pending' });
});
it('charges one delivery fee per door delivery date (PRD §6.9)', async () => {
  // pay Gerai's door basket (fee 1200 for 2026-11-10) → siti joins OIL by door → deliveryFeeSen 0
});
it('refunds a cancelled line in full before cut-off (story 57)', async () => {
  const r = (await ah.post(`/api/participations/${cmPart}/cancel`)).body;
  expect(r).toEqual({ refundSen: 98454, deliveryFeeRefundSen: 0 });
  expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(98454);
});
it('refunds the delivery fee when the last door line for that date is cancelled', async () => {
  /* Gerai cancels its 4 lines → the last cancel returns deliveryFeeRefundSen 1200 */
});
it('refuses to cancel after cut-off', async () => {
  app.clock.set('2026-11-05T12:00:01Z');
  expect((await ah.post(`/api/participations/${cmPart}/cancel`)).status).toBe(409);
});
it('keeps cancelling and joining from staff', async () => {
  /* rahim → 403 on both */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(payments): join from the catalogue and cancel before cut-off`

---

### Task 5: Seeding the demo week through the services

**Files:**

- Create: `prisma/seed/current-week.ts`
- Modify: `prisma/seed/index.ts` (remove the M3 phase `openRoundsAtAnchor`; add `seedCurrentWeek`), `src/server/platform/tx.ts` (new export `setTransactionNow(now: Date)`: sets the `now` that later joined `withTransaction` calls receive; no-op outside a transaction), `tests/api/catalogue-rounds.test.ts` (it expects an empty round on the demo seed)
- Test: `tests/api/seed-current-week.test.ts`

**Interfaces:**

- Produces: `seedCurrentWeek(ctx: TxContext, anchorMonday: Date): Promise<void>`. `seedDemo` calls it in place of `openRoundsAtAnchor`, inside its single transaction (so `resetDemo` stays atomic). A transaction has one `now`, and `deps.prisma` cannot see its uncommitted rows, so there is no seed clock and no `draftWeeklyBaskets(deps)` call. Instead each step calls `setTransactionNow(t)` and then the real services, which read through `ctx.tx`; at the end it restores the original `now`. The anchor is Mon 06:05 MYT. Steps:
  1. **Thu 29 Oct 20:00 MYT** (anchor − 3 d 10 h 5 min): `openNextRound` for every active product.
  2. **Background joins**, k = 0…80 in index §5.7 order, at Fri 30 Oct 09:00 MYT + k × 45 min: `joinRound` as `systemCaller('seed')` with `opts { shopId: BG(k mod 40 + 1), source: 'background_seed', settleImmediatelyWith: 'fpx' }`. Each shop uses its default destination.
  3. **Mon 06:00:** `draftBasketForShop(ctx, shopId, isoWeekOf(anchorMonday))` for Gerai and Kafe (the non-background shops with usual lists).
  4. **06:01:** Siti approves Gerai's basket and the simulated payment succeeds (`duitnow_qr`). The seed builds Siti's `Session` from her seeded membership (`seedId('membership', 'siti')`, role `owner`, her `shopId`) and calls `approveBasket` and `simulatePaymentResult` with `personCaller(session)`.
  5. **06:03:** Mei does the same for Kafe (`fpx`).
  6. Finish at 06:05 (the anchor).

- [ ] **Step 1: Write the failing tests** (`seed: 'demo'`):

```ts
it('lands every round on the designed totals (index §5.7)', async () => {
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
  expect((await roundProgress(app.prisma, cmRound)).shopCount).toBe(8);
});
it('gives each background shop two or three rounds, joined Friday to Sunday', async () => {
  /* counts 2..3; joinedAt within [2026-10-30T01:00Z, 2026-11-01T13:00Z] */
});
it('has Gerai and Kafe paid at 06:01 and 06:03, with Gerai’s door fee held', async () => {
  expect(await feeChargeOf('GERAI', '2026-11-10')).toMatchObject({
    amountSen: 1200,
    status: 'held',
  });
  expect(await participationOf('KAFE', 'EGG_B')).toMatchObject({
    quantity: 10,
    priceLimitSen: 1220,
    paidSen: 12330,
  });
});
it('reaches 105 cartons at tier 3 once Kedai Kopi Contoh pays (milestone check)', async () => {
  await setupKedaiKopi(app);
  await payBasket(app, 'ahSeng', await basketIdOf('KEDAI_KOPI', '2026-W45'));
  expect(await roundProgress(app.prisma, cmRound)).toMatchObject({
    totalQuantity: 105,
    shopCount: 9,
    currentTier: 3,
  });
});
it('passes every money check and log verification after seeding', async () => {
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
  expect((await verifyLogChain(app.prisma)).valid).toBe(true);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS. Measure the duration of `resetDemo` and record it for M9.
- [ ] **Step 5: Commit:** `feat(seed): build the demo week through the real services`

---

### Task 6: Payment views, receipts and the money history

**Files:**

- Create: `src/server/modules/payments/views.ts`, `src/lib/views/payments.ts`, `src/app/api/payments/[paymentId]/route.ts`, `src/app/api/payments/[paymentId]/receipt/route.ts`, `src/app/api/shops/[shopId]/balance/route.ts`
- Test: `tests/api/receipts-balance.test.ts`

**Interfaces:**

- Produces:
  - `getPaymentForCaller(deps, caller, paymentId): Promise<PaymentView>`.
  - `getReceipt(deps, caller, paymentId): Promise<ReceiptView>`, for succeeded payments only (otherwise 409).
    - `ReceiptView = { paymentId; issuedAt; shopName; lines: { productName; quantity; unitAllInSen; unitGoodsSen; unitFeeSen; unitShippingSen; lineSen }[]; deliveryFeeSen; balanceAppliedSen; paidSen; totalSen; method; partnerReference; notice: 'Issued by BeliKongsi (simulated). Not a tax invoice.' }`
  - `getBalanceView(deps, caller, shopId, page): Promise<{ balanceSen: number; history: { items: MoneyHistoryItem[]; nextCursor: string | null } }>` (owner and Ops).
    - `MoneyHistoryItem = { at; kind: 'payment' | 'balance_used' | 'refund' | 'claim_refund'; label: string; amountSen: number; balanceChangeSen: number; runningBalanceSen: number; reason: string | null }`
    - Newest first, in plain English, for example "Refund: condensed milk closed at a lower price" or "Payment (simulated) — DuitNow QR".

- [ ] **Step 1: Write the failing tests** (`seed: 'demo'` plus Kedai Kopi paid):

```ts
it('lists every line, the fee and the shipping share on the receipt (story 55)', async () => {
  const r = (await ah.get(`/api/payments/${pid}/receipt`)).body;
  expect(r.lines.find((l: any) => l.productName.startsWith('Sweetened condensed milk'))).toEqual(
    expect.objectContaining({
      quantity: 6,
      unitAllInSen: 16409,
      unitGoodsSen: 15800,
      unitFeeSen: 316,
      unitShippingSen: 293,
      lineSen: 98454,
    }),
  );
  expect(r.notice).toBe('Issued by BeliKongsi (simulated). Not a tax invoice.');
});
it('keeps a running balance in the money history (story 56)', async () => {
  /* a refund of 98454, then 50000 of balance used → newest first, runningBalanceSen 48454 then 98454 */
});
it("hides another shop's receipts and balance", async () => {
  /* siti GET Kedai receipt → 404; GET Kedai balance → 404 */
});
it('lets Ops read a shop’s money history', async () => {
  /* nadia GET Kedai balance → 200 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(payments): add receipts and the money history`

---

### Task 7: Skip, reminders, expiry and the jobs runner

**Files:**

- Create: `vercel.json` (a cron entry for `GET /api/jobs/run`; the repo has none yet), `src/server/modules/baskets/lifecycle.ts`, `src/server/modules/jobs/run.ts`, `src/server/platform/due-work.ts`, `src/app/api/baskets/[basketId]/skip/route.ts`, `src/app/api/jobs/run/route.ts`
- Modify: `src/server/modules/notifications/templates.ts` (`basket.reminder`)
- Test: `tests/api/basket-lifecycle-jobs.test.ts`

**Interfaces:**

- Produces:
  - `skipBasket(deps, caller, basketId, { reason?: string })`: an owner skips a draft. The basket becomes `skipped`, its approval `rejected` (the reason is optional for baskets, PRD §12), and it logs `basket.skipped` and emits `basket.skipped`.
  - `sendBasketReminders(deps): Promise<{ sent: number }>`. Draft baskets get reminders at `deadline − 24 h` and `deadline − 3 h`, with dedupe keys `basket-reminder:<basketId>:24h` and `:3h`. The texts are `Reminder: your Kongsi basket closes tomorrow at 8 pm.` and `Reminder: your Kongsi basket closes today at 8 pm.`
  - `expireBaskets(deps): Promise<{ expired: number }>`. Draft or `payment_pending` baskets past their deadline: pending payments become `voided` (`payment.voided` logged), the basket `expired`, the approval `expired`; it logs `basket.expired` and emits `basket.expired`. Nothing is charged.
  - `runDueJobs(deps): Promise<{ openedRounds: number; draftedBaskets: number; reminders: number; expiredBaskets: number }>`. Order: `openDueRounds` → `draftWeeklyBaskets` → `sendBasketReminders` → `expireBaskets`. M5 inserts `closeDueRounds` before `expireBaskets`.
  - `GET` and `POST /api/jobs/run` need `Authorization: Bearer <CRON_SECRET>` (401 otherwise); Vercel Cron uses GET.
  - `scheduleDueWork(deps)`: calls `after(() => runDueJobs(deps))`, at most once per 30 seconds per server instance. Owner and Ops page components call it (R11).

- [ ] **Step 1: Write the failing tests** (`seed: 'demo'`, with Kedai Kopi set up and its basket undecided):

```ts
it('skips this week without charging (story 36)', async () => {
  /* skip → status skipped; no payments; approval rejected */
});
it('reminds an undecided owner 24 h and 3 h before cut-off, once each (story 37)', async () => {
  app.clock.set('2026-11-04T12:00:00Z');
  await sendBasketReminders(app.deps);
  await sendBasketReminders(app.deps);
  app.clock.set('2026-11-05T09:00:00Z');
  await sendBasketReminders(app.deps);
  const texts = (
    await app.prisma.notification.findMany({
      where: { type: 'basket.reminder', userId: seedId('user', 'ahSeng') },
      orderBy: { createdAt: 'asc' },
    })
  ).map((n) => n.whatsappText);
  expect(texts).toEqual([
    'Reminder: your Kongsi basket closes tomorrow at 8 pm.',
    'Reminder: your Kongsi basket closes today at 8 pm.',
  ]);
});
it('expires an unapproved basket at cut-off without charging (story 38)', async () => {
  /* clock past the deadline → expireBaskets → expired; pending payment voided; postings unchanged */
});
it('needs the cron secret to run jobs', async () => {
  expect((await callRoute('GET', '/api/jobs/run')).status).toBe(401);
  expect(
    (await callRoute('GET', '/api/jobs/run', { headers: { authorization: `Bearer ${CRON}` } }))
      .status,
  ).toBe(200);
});
it('changes nothing when the jobs run twice', async () => {
  /* two runs → the second report is all zeros */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(jobs): skip, reminders, expiry and the protected jobs runner`

---

### Task 8: Basket, checkout, money and staff screens

**Files:**

- Create:
  - Shadcn components: `src/components/ui/sheet.tsx`, `src/components/ui/tabs.tsx` (added with the shadcn CLI)
  - Pages: `src/app/(shell)/owner/basket/page.tsx`, `src/app/checkout/[paymentId]/page.tsx`, `src/app/(shell)/owner/receipts/[paymentId]/page.tsx`, `src/app/(shell)/owner/money/page.tsx`, `src/app/(shell)/owner/kongsi/page.tsx`, `src/app/(shell)/staff/add/page.tsx`
  - Components: `src/components/baskets/*`, `src/components/checkout/*`, `src/components/rounds/join-sheet.tsx`, `src/components/rounds/why-this-price-sheet.tsx`
- Modify:
  - `src/app/(shell)/owner/page.tsx`: the basket card with countdown, amount now, about after cut-off, estimated savings and "Approve & pay".
  - `src/app/(shell)/staff/page.tsx`: two big buttons, "Add to next basket" and "Confirm delivery". The second leads to an empty state until M7.
  - `src/app/(shell)/owner/rounds/[roundId]/page.tsx`: "Join" opens the join sheet.

- [ ] **Step 1: Build the basket screen** (PRD §22 "Weekly basket").
  - Each line shows its starting price, projected price and estimated savings (labelled "Estimated").
  - Staff changes are highlighted ("Rahim: +1").
  - "Why this price?" opens a bottom sheet with the line's `explanation` sentences and the delivery-fee note.
  - Other controls: the fulfilment switch, the totals block (items at the starting price, BeliKongsi fee included, delivery fee, balance used, pay now, about after cut-off), "Approve & pay", "Skip this week" with an optional reason, and the deadline countdown.
- [ ] **Step 2: Build the checkout and money screens.**
  - **Checkout:** the banner "Simulated payment — no real money moves"; tabs "DuitNow QR" (a generic placeholder QR drawn as SVG) and "FPX online banking" (fictional banks "Bank Satu Contoh", "Bank Dua Contoh", "Koperasi Contoh"); "Pay (simulated)" and "Simulate failure". Success leads to the receipt; failure offers a retry.
  - **Receipt and money pages:** as Task 6.
  - **My Kongsi:** active lines with "Cancel", which asks for confirmation.
- [ ] **Step 3: Build the join sheet.** Quantity, price limit and fulfilment, live-quoted through `GET /api/rounds/{id}/quote`. It shows the PRD §6.4 warning when the limit is below the starting price, then pays through the checkout.
- [ ] **Step 4: Build the staff add screen.** Search by any name, a quantity stepper, and "Add to next basket". The toast reads "Added. Waiting for owner's approval." My recent additions show their status.
- [ ] **Step 5: Verify** with Chrome DevTools at 390 × 844 after `pnpm db:reset`:
  1. Ah Seng runs setup, then opens the basket. "Why this price?" on condensed milk shows "99 cartons so far. 1 more carton and everyone pays RM 146.00."
  2. Switch to Rahim and add 1 carton of evaporated milk.
  3. Back as Ah Seng, the highlight shows. Approve & pay with DuitNow QR.
  4. The receipt shows condensed milk 6 × RM 164.09 = RM 984.54.
  5. Open rounds shows 105 cartons at tier 3.
  6. Staff screens show no money.
- [ ] **Step 6:** Run `pnpm verify`. Expected: PASS.
- [ ] **Step 7: Commit:** `feat(ui): add basket, checkout, receipts, money and staff screens`

---

### Milestone verification

- [ ] Run `pnpm verify`, then `pnpm db:reset` and the Task 8 walkthrough.
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 9, 27–39, 46, 47, 52–58, 95–98, 102, 146), including the reset duration.
