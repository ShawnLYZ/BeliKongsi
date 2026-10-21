# M12 P1 Delivery Exceptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When things run late or go uncollected, nobody is stuck:

- Owners hear about delays and new dates, and can cancel a late item for a full refund after 3 days.
- Goods that arrive in parts can be collected in parts.
- Uncollected goods and unchecked deliveries get reminders.
- Suppliers and Ops are chased before rounds stall.

**Architecture:** New jobs join `runDueJobs`: `detectLateDeliveries`, `remindUncollected`, `enforceCheckWindow` and `sendOperationalReminders`. Late cancellation uses build design P1-7's two money branches. Partial collection adds a `PickupCollection` entity, so a delivery check belongs to a collection rather than to a pickup (O7). Every reminder deduplicates through notification keys.

**Tech Stack:** Prisma migrations, the M2–M11 services.

**Spec:** build design §9 P1-7 to P1-11 and O7; PRD stories 74, 75, 83, 116, 134, 135; PRD §1 (P1 list), §5 ("P1" notes), §10 ("P1 adds partial collection"), §11 (P1 claim window), §12 (P1 reminders and escalation), §13 ("Later").

## Global Constraints

- Index §2 (G1–G10) applies.
- P1-7:
  - late means not ready, or not out for delivery, by the expected ready time (Tue 10:00 MYT by default)
  - an owner can cancel an item once the time is 72 hours past the original expected ready time
  - before the hub check, the refund comes from the round hold and the supplier order's `acceptedQuantity` falls
  - after the hub check, the refund comes from claims expense
  - the delivery fee comes back only when no door lines remain and nothing was dispatched
- P1-8: later partial deliveries never add delivery fees.
- P1-9: reminders on day 1 and day 3 after ready; an Ops alert on day 7.
- P1-10: a 72-hour window with a reminder at 24 hours; at 72 hours the delivery closes as "received, not checked", savings stay estimated, and claims are refused.
- P1-11:
  - a supplier confirmation pending 12 hours reminds the supplier and notifies Ops
  - an Ops approval pending 12 hours is marked overdue, and every Ops user is reminded
  - a missed dispatch date, or an overdue hub check, alerts Ops
  - each reminder is sent once
- Staff notices never contain amounts (R6).

## Review Focus

1. **A late cancellation at 71 h 59 min:** 409 `TOO_EARLY`. At exactly 72 h it's allowed. Pinned in Task 2.
2. **A late cancellation after the door consignment was dispatched:** no delivery-fee refund, because the fee was already passed to the partner. Pinned in Task 2.
3. **Goods collected in two parts:** the same code works twice, there's one check per collection, and the pickup closes only after both checks. Pinned in Task 3.
4. **A problem reported after the 72-hour window closed:** 409 `CHECK_WINDOW_CLOSED`. Pinned in Task 4.
5. **Reminder jobs running every few minutes:** each reminder is sent exactly once. Pinned in Tasks 4 and 5.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m12-p1-delivery-exceptions`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names: `refreshPickupReadiness`, `collectPickup`, `submitDeliveryCheck`, `updateConsignmentStatus`, `recordHubCheck` (capping at `acceptedQuantity`), `refundDeliveryFeeIfUnused`, `runDueJobs`, `notify` (dedupe keys).
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Detecting late deliveries and setting new dates (P1-7, notices)

**Files:**

- Create: `prisma/migrations/<ts>_p1_delivery/migration.sql`, `src/server/modules/fulfilment/late.ts`, `src/app/api/consignments/[id]/delay/route.ts`, `src/app/api/supplier-orders/[id]/delay/route.ts`
- Modify:
  - `prisma/schema.prisma`:
    - model `LateDelivery` (`late_deliveries`): id, shopId, destinationKey, deliveryDate, originalExpectedAt, newExpectedAt?, reason?, detectedAt; unique (shopId, destinationKey, deliveryDate)
    - `ParticipationStatus` += `cancelled_late`
    - `PostingKind` += `refund_late`
    - `PickupStatus` += `partly_ready`
    - `CheckResult` += `not_checked`
    - `ApprovalRequest` += `overdueAt DateTime?`
    - model `PickupCollection` (`pickup_collections`): id, pickupId, collectedAt, collectedByUserId?, method ('code' | 'courier' | 'system')
    - `Allocation` += `collectionId?`, `cancelledLateAt?`
    - `DeliveryCheck`: `pickupId` is no longer unique; add `collectionId` (unique)
    - The migration ends with `SELECT bk_secure_all_tables();`.
  - `src/server/modules/jobs/run.ts`: add `detectLateDeliveries`.
  - `src/server/modules/notifications/templates.ts`: `delivery.late`, `delivery.new_date`.
- Test: `tests/api/late-detection.test.ts`

**Interfaces:**

- Produces:
  - `detectLateDeliveries(deps): Promise<{ detected: number }>`.
    - Groups are (shop, destination key, delivery date) over participations in `kept` or `allocated`.
    - A group is late when its pickup isn't `ready`, `partly_ready`, `out_for_delivery`, `collected` or `delivered` at its expected ready time.
    - It writes `LateDelivery` once, and notifies owner and staff: `Your goods for {formatMytDate(date)} are running late. We'll tell you the new date.`
  - `setNewDate(deps, caller, target: { consignmentId } | { supplierOrderId }, { newDate: string; reason: string }): Promise<void>` (Ops; the reason is required).
    - It updates `newExpectedAt` for every affected group.
    - Notice to owner and staff: `New date for your goods: {formatMytDate(newDate)}. Reason: {reason}.`

- [ ] **Step 1: Write the failing tests:**

```ts
it('tells owner and staff when goods are late (story 74)', async () => {
  app.clock.set('2026-11-10T02:00:01Z');
  await detectLateDeliveries(app.deps);
  await detectLateDeliveries(app.deps);
  expect(await countWhatsapp('ahSeng', 'delivery.late')).toBe(1);
  expect(await lastWhatsapp('rahim', 'delivery.late')).toBe(
    "Your goods for Tue 10 Nov are running late. We'll tell you the new date.",
  );
});
it('sends the new date that Ops sets', async () => {
  await nadia.post(`/api/consignments/${kvIpoh}/delay`, {
    newDate: '2026-11-12',
    reason: 'Truck breakdown',
  });
  expect(await lastWhatsapp('ahSeng', 'delivery.new_date')).toBe(
    'New date for your goods: Thu 12 Nov. Reason: Truck breakdown.',
  );
});
it('needs a reason for a new date', async () => {
  /* without reason → 422 REASON_REQUIRED */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fulfilment): detect late deliveries and announce new dates`

---

### Task 2: Cancelling a late item (P1-7, money decision)

**Files:**

- Create: `src/server/modules/fulfilment/late-cancel.ts`, `src/app/api/participations/[id]/late-cancel/route.ts`
- Modify: `src/server/modules/ledger/checks.ts` (count `refund_late` from the round hold as a refund; treat post-hub late refunds like claims), `src/server/modules/notifications/templates.ts` (`delivery.late_cancelled`)
- Test: `tests/api/late-cancel.test.ts`

**Interfaces:**

- Produces: `cancelLateItem(deps, caller, participationId): Promise<{ refundSen: number; deliveryFeeRefundSen: number; source: 'round_hold' | 'claims_expense' }>` (owner, idempotent route).
  - **Timing:** allowed once `now ≥ originalExpectedAt + 72 h`; earlier gets 409 `TOO_EARLY`.
  - **Eligibility:** the item must be `kept`, or `allocated` and not yet collected or delivered; otherwise 409 `NOT_CANCELLABLE`.
  - **Before the hub check** (`kept`): post `round_hold → shop_balance` (`refund_late`) for `finalAllInSen × quantity`. The participation becomes `cancelled_late`, and the supplier order's `acceptedQuantity` falls by the quantity.
  - **After the hub check** (`allocated`): post `claims_expense → shop_balance` (`refund_late`) for `allocated × finalAllInSen`. The allocation gets `cancelledLateAt` and the participation becomes `cancelled_late`. `refreshPickupReadiness` runs; a pickup with no live allocations closes.
  - **Always:** `refundDeliveryFeeIfUnused`; the event `refund.issued { kind: 'late' }`; owner notice `Cancelled a late item: {units} of {shortName}. {RM} is back in your balance.`

- [ ] **Step 1: Write the failing tests:**

```ts
it('refuses at 71 h 59 min and allows at 72 h', async () => {
  app.clock.set('2026-11-13T01:59:00Z');
  expect((await ah.post(`/api/participations/${cmPart}/late-cancel`)).status).toBe(409);
  app.clock.set('2026-11-13T02:00:00Z');
  expect((await ah.post(`/api/participations/${cmPart}/late-cancel`)).status).toBe(200);
});
it('refunds from the round hold before the hub check and lowers the accepted quantity', async () => {
  // CM round 'dispatched', no hub check yet
  const r = (await ah.post(`/api/participations/${cmPart}/late-cancel`)).body;
  expect(r).toMatchObject({ refundSen: 6 * 15185, source: 'round_hold' });
  expect((await order(cmOrder)).acceptedQuantity).toBe(99);
  // a later hub check with 105 good → excessUnits 6 and supplier payout 99 × 14600
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
});
it('refunds from claims expense after the hub check', async () => {
  /* hub-checked, consignment planned → source 'claims_expense', refund 6 × 15185 */
});
it('keeps the delivery fee once the door consignment has been dispatched', async () => {
  /* GERAI door dispatched → deliveryFeeRefundSen 0 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fulfilment): cancel late items with the right refund source`

---

### Task 3: Partial collection (P1-8)

**Files:**

- Modify: `src/server/modules/fulfilment/readiness.ts`, `src/server/modules/fulfilment/pickups.ts`, `src/server/modules/checks/delivery-check.ts`, `src/server/modules/fulfilment/background.ts`, `src/server/modules/notifications/templates.ts` (`pickup.partly_ready`), `src/lib/views/pickups.ts`
- Test: `tests/api/partial-collection.test.ts`, plus the existing M7 and M8 tests, which must still pass.

**Interfaces:**

- Produces:
  - **Readiness:** an allocation is collectable when its consignment has `arrived` (pickup point) or been `delivered` (door). A pickup is `partly_ready` when some, but not all, uncollected allocations are collectable. The owner and staff get `Part of your goods is ready at {place} ({hours}). Pickup code {code}.`
  - `collectPickup` creates a `PickupCollection` holding every collectable, uncollected allocation. The pickup becomes `collected` once nothing is left to collect.
  - `submitDeliveryCheck(deps, caller, pickupId, input & { collectionId: string })`:
    - one check per collection; a repeat gets 409 `CHECK_EXISTS`
    - the lines are limited to that collection's allocations
    - the pickup closes when every allocation is collected and every collection is checked (claims decided)
  - `PickupView` gains `collections: { collectionId; collectedAt; checked: boolean; lines }[]`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('lets staff collect what has arrived and the rest later with the same code', async () => {
  // Johor→Ipoh (eggs) arrives first → partly_ready → collect → collection 1; KV→Ipoh arrives → ready → collect → collection 2
  expect((await pickupOf('KEDAI_KOPI', '2026-11-10')).status).toBe('collected');
  expect(await app.prisma.pickupCollection.count({ where: { pickupId: p.id } })).toBe(2);
});
it('needs a check for each collection before the pickup closes', async () => {
  /* check collection 1 → pickup not closed; check collection 2 → closed */
});
it('charges no extra delivery fee for a second door delivery', async () => {
  /* GERAI two door collections → delivery_fee_charges row count 1, amount 1200 */
});
```

- [ ] **Step 2:** Run the new tests and `pnpm test:api`. **Step 3:** Implement. **Step 4:** Run everything. Expected: PASS. The M7, M8 and lifecycle tests are unchanged, with a single collection in the full-arrival path.
- [ ] **Step 5: Commit:** `feat(fulfilment): collect and check goods in parts`

---

### Task 4: Uncollected goods and the check window (P1-9, P1-10)

**Files:**

- Create: `src/server/modules/fulfilment/reminders.ts`
- Modify: `src/server/modules/jobs/run.ts` (`remindUncollected`, `enforceCheckWindow`), `src/server/modules/checks/delivery-check.ts` (refuse after the window), `src/server/modules/savings/savings.ts` (`not_checked` stays estimated), `src/server/modules/notifications/templates.ts`
- Test: `tests/api/uncollected-check-window.test.ts`

**Interfaces:**

- Produces:
  - `remindUncollected(deps)`:
    - Day 1 (≥ 24 h after `readyAt`) and day 3 (≥ 72 h): owner and staff get `Your goods are waiting at {place} ({hours}). Pickup code {code}.`, with dedupe keys `uncollected:<pickupId>:d1` and `:d3`.
    - Day 7 (≥ 168 h): Ops get `Goods uncollected for 7 days: {shop name} at {place}.` (dedupe `:d7`).
  - `enforceCheckWindow(deps)`:
    - At 24 h after a collection (or door delivery) without a check, owner and staff get `Please check the goods you received on {date}: tap to confirm or report a problem.`
    - At 72 h it writes a system `DeliveryCheck` with `result 'not_checked'`, closes the participations and closes the pickup when complete.
    - A later `submitDeliveryCheck` gets 409 `CHECK_WINDOW_CLOSED`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('reminds on day 1 and day 3 and alerts Ops on day 7, once each (stories 75, 135)', async () => {
  /* advance the clock 24 h / 72 h / 168 h past readyAt, running the job twice at each point */
});
it('reminds at 24 h and closes as "received, not checked" at 72 h (story 83, P1-10)', async () => {
  // collect at T; T+24 h → reminder; T+72 h → check result 'not_checked'; CM savings status stays 'estimated'
});
it('refuses a problem report after the window closes', async () => {
  /* → 409 CHECK_WINDOW_CLOSED */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fulfilment): uncollected reminders and the delivery-check window`

---

### Task 5: Supplier and Ops reminders with escalation (P1-11)

**Files:**

- Create: `src/server/modules/supplier-orders/reminders.ts`
- Modify: `src/server/modules/jobs/run.ts` (`sendOperationalReminders`), `src/server/modules/approvals/approvals.ts` (`overdueAt` in `ApprovalView`), `src/server/modules/notifications/templates.ts`
- Test: `tests/api/operational-reminders.test.ts`

**Interfaces:**

- Produces: `sendOperationalReminders(deps): Promise<{ sent: number }>`:
  - **A `supplier_confirmation` pending ≥ 12 h:**
    - supplier: `Reminder: please confirm the BeliKongsi order for {units} of {shortName}.`
    - Ops: `{Supplier} hasn't confirmed the {shortName} order after 12 hours.`
  - **An Ops approval (`supplier_order`, `claim` or `data_deletion`) pending ≥ 12 h:** set `overdueAt`; every Ops user gets `Overdue approval: {summary}.`
  - **Confirmed but not dispatched after 23:59:59 MYT on `requiredDispatchDate`:** Ops get `Not dispatched yet: {units} of {shortName} from {Supplier} (due {formatMytDate}).`
  - **Dispatched with no hub check after 23:59:59 MYT on `expectedHubDate`:** Ops get `Hub check overdue: {shortName} from {Supplier} (expected {formatMytDate}).`
  - Every notice has a dedupe key per subject and kind.

- [ ] **Step 1: Write the failing tests:**

```ts
it('reminds the supplier and tells Ops after 12 hours without confirmation (stories 116, 134)', async () => {
  /* … exact texts, once each */
});
it('marks Ops approvals overdue after 12 hours', async () => {
  /* GET /api/approvals → overdueAt set; one notice per Ops user */
});
it('alerts Ops about a missed dispatch date and an overdue hub check', async () => {
  /* advance past 2026-11-07 23:59:59 MYT; then past 2026-11-09 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ops): reminders and escalation for stalled orders and approvals`

---

### Task 6: Screens

**Files:**

- Modify: owner and staff pickup screens (late banner, new date, "Cancel late item" after 72 h with confirmation), staff deliveries (partial collection and checks per collection), Ops inbox (overdue badges), Ops consignment and supplier-order pages ("Set new date" with a reason)

- [ ] **Step 1: Build the screens.** Apply the changes above, keeping amounts off every staff screen.
- [ ] **Step 2: Verify at 390 × 844.**
  1. Delay the Ipoh consignment, then cancel a late item after advancing the demo clock 72 h.
  2. Collect in two parts, with two checks.
  3. Run the jobs and see the reminders.
  4. Run `pnpm verify`. Expected: PASS.
- [ ] **Step 3: Commit:** `feat(ui): late deliveries, partial collection and overdue work`

---

### Milestone verification

- [ ] Run `pnpm verify` (with `e2e`).
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 74, 75, 83, 116, 134, 135, plus partial collection and the check window).
