# M6 Ops Approvals and Supplier Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing consequential happens without a person:

- Ops approves each supplier order against shown evidence.
- The supplier confirms or rejects it in a small portal that never reveals shops.
- Ops records the hub check, previews the first-come shortfall allocation, and releases a simulated payout for good units only.
- Ops can see every round and prove that the money balances.

**Architecture:** M2's approval handlers get two implementations: `supplier_order` (Ops) and `supplier_confirmation` (supplier). Rejections share `cancelRoundWithRefunds`. `recordHubCheck` runs the engine's `allocateShortfall` and writes allocations, shortfall refunds, settlement postings and the payout in one transaction. M7 extends it with consignments. The `ops` module builds the rounds board, round detail and money overview from the ledger and `runMoneyChecks`.

**Tech Stack:** the M1 engine, M2 approvals, ledger and notifications, shadcn/ui tables.

**Spec:** PRD §5 (round and supplier-order states), §6.7, §8 (hub check and payout postings), §9, §12, §13 (supplier and Ops notices, shortfall), §15 (supplier view rules), §20 (approvals, supplier portal, Ops), §22 (supplier and Ops screens), stories 65, 103–112, 117–123, 129–131, 176; build design C10; index §4.5, §5.8.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §12: Ops approval sends the order to the supplier; a reject needs a reason and cancels the round with full refunds; supplier confirmation needs an expected dispatch date; a supplier rejection needs a reason, cancels the round with full refunds, and notifies Ops.
- PRD §15: supplier responses never contain shop identifiers, names or per-shop quantities; suppliers see only their own orders and products.
- PRD §6.7 settlement for good units: supplier payable = R × final goods price; fee revenue = Σ allocated × unit fee; logistics payable = Σ allocated × unit shipping share; the final price never changes because of a shortfall.
- PRD §8 hub-check postings: `round hold → shop balance` (shortfall refunds); `round hold → supplier payable`; `round hold → fee revenue`; `round hold → logistics payable`; payout `supplier payable → partner cash`.
- PRD §13 texts:
  - "New BeliKongsi order: 105 cartons of condensed milk for the Klang Valley hub. Please confirm."
  - "Payment released: RM 15,330.00 for 105 cartons (simulated)."
  - "Ladang Telur Contoh rejected the Grade A eggs order: out of stock."
  - "The supplier couldn't fill flour this week. Full refund: RM …."
  - "The supplier delivered short. 2 cartons of condensed milk refunded: RM 306.42."
- Every payout, payment or partner screen says "Simulated" (PRD §22).

## Review Focus

1. **A supplier confirms with a dispatch date in the past, or a malformed one:** 400, with nothing changed. Pinned in Task 2.
2. **Ops records a hub check twice, for example after a double click:** the second gets 409, with no second payout or refunds. Pinned in Task 3.
3. **Hub check with zero good units:** every participation is shorted and refunded in full, the payout is 0, and there's no zero-amount posting. Pinned in Task 3.
4. **A supplier opens another supplier's order by id:** 404, never the order. Pinned in Task 2.
5. **Ops rejects an order for a shop that also has door lines kept in other rounds for the same date:** the delivery fee stays held. Pinned in Task 1.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m06-ops-approvals-and-supplier-portal`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names:
  - M2: `registerApprovalHandler`, `decideApproval`, `listPendingApprovals`, `createApproval`, `post`, `runMoneyChecks`.
  - M1: `allocateShortfall`.
  - M4: `simulatedPayments.payout`, `refundDeliveryFeeIfUnused` (extracted in M5).
  - M5: `draftSupplierOrder`, `closeDueRounds`, `skipToCutoff`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Ops decides supplier orders

**Files:**

- Create: `src/server/modules/supplier-orders/ops-decision.ts`, `src/server/modules/rounds/cancel.ts`
- Modify (test helpers): `tests/api/helpers/scans.ts` (add `expectNoShopIdentity`); `tests/api/helpers/scenarios.ts` (add `toFormed`, plus the index §4.5 lookups this milestone uses)
- Modify: `src/server/modules/notifications/templates.ts` (`supplier.new_order`, `owner.order_rejected`)
- Test: `tests/api/ops-decision.test.ts`

**Interfaces:**

- Produces:
  - **The `supplier_order` approval handler:**
    - **Approve:** the order becomes `awaiting_supplier` and the round `ordered`. It creates the approval `supplier_confirmation` (assignee `supplier`, `supplierId`, amount = total), logs `supplier_order.approved` and emits `supplier_order.approved { supplierOrderId, roundId, supplierId, quantity, totalSen }`. It notifies the supplier: `New BeliKongsi order: {units} of {shortName} for the {hub name}. Please confirm.`
    - **Reject:** the order becomes `rejected_by_ops`, then `cancelRoundWithRefunds(ctx, roundId, { by: 'ops', reason })`, and it logs `supplier_order.rejected_by_ops`.
  - `cancelRoundWithRefunds(ctx, roundId, input: { by: 'ops' | 'supplier'; reason: string }): Promise<{ refundedSen: number }>`:
    - Every `kept` participation becomes `refunded_round_cancelled`, posting `round_hold → shop_balance` (`refund_round_cancelled`) for its `finalLine`, so the hold ends at 0.
    - `refundDeliveryFeeIfUnused` runs for each door shop and date.
    - The round becomes `cancelled`. It logs `refund.issued` per shop and emits `round.cancelled { roundId, by, reasonCode }` and `refund.issued { kind: 'full' }`.
    - Owners get one message per shop:
      - by supplier: `The supplier couldn't fill {shortName} this week. Full refund: {RM}.`
      - by Ops: `BeliKongsi cancelled the {shortName} order this week. Full refund: {RM}.`
    - Here `{RM}` is everything the shop paid for that round.
  - `expectNoShopIdentity(value, shopNames: string[], shopIds: string[])`: a deep scan of keys and string values.

- [ ] **Step 1: Write the failing tests.** The setup helper `toFormed(app)` does `seed: 'demo'`, sets up and pays Kedai Kopi, then skips to cut-off.

```ts
it('sends the order to the supplier when Ops approves (story 119)', async () => {
  await (await app.as('nadia')).post(`/api/approvals/${opsApprovalOf(cmOrder)}/approve`, {});
  expect(await order(cmOrder)).toMatchObject({ status: 'awaiting_supplier' });
  expect((await round(cmRound)).status).toBe('ordered');
  expect(await lastWhatsapp('farid', 'supplier.new_order')).toBe(
    'New BeliKongsi order: 105 cartons of condensed milk for the Klang Valley hub. Please confirm.',
  );
});
it('lets only Ops approve supplier orders', async () => {
  expect(
    (await (await app.as('farid')).post(`/api/approvals/${opsApprovalOf(cmOrder)}/approve`, {}))
      .status,
  ).toBe(403);
  expect(
    (await (await app.as('ahSeng')).post(`/api/approvals/${opsApprovalOf(cmOrder)}/approve`, {}))
      .status,
  ).toBe(404);
});
it('needs a reason to reject, then refunds everyone in full (stories 65, 120)', async () => {
  const n = await app.as('nadia');
  expect((await n.post(`/api/approvals/${opsApprovalOf(flourOrder)}/reject`, {})).status).toBe(422);
  await n.post(`/api/approvals/${opsApprovalOf(flourOrder)}/reject`, {
    reason: 'Supplier price dispute',
  });
  expect((await round(flourRound)).status).toBe('cancelled');
  expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: flourRound })).toBe(0);
  expect(await lastWhatsapp('siti', 'owner.order_rejected')).toMatch(
    /^BeliKongsi cancelled the flour order this week\. Full refund: RM [\d,.]+\.$/,
  );
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
});
it('keeps Gerai Contoh’s delivery fee when its other door lines are still kept', async () => {
  expect(await feeChargeOf('GERAI', '2026-11-10')).toMatchObject({ status: 'held' });
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement and register the handler. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(supplier-orders): Ops approves or rejects with full refunds`

---

### Task 2: The supplier confirms, rejects and dispatches

**Files:**

- Create: `src/server/modules/supplier-orders/supplier-decision.ts`, `src/server/modules/supplier-orders/portal.ts`, `src/lib/views/supplier.ts`
- Routes: `src/app/api/suppliers/[supplierId]/orders/route.ts`, `src/app/api/suppliers/[supplierId]/rounds/route.ts`, `src/app/api/suppliers/[supplierId]/products/route.ts`, `src/app/api/suppliers/[supplierId]/payouts/route.ts`, `src/app/api/supplier-orders/[id]/dispatched/route.ts`
- Modify: `src/server/modules/notifications/templates.ts` (`ops.supplier_rejected`)
- Test: `tests/api/supplier-portal.test.ts`

**Interfaces:**

- Produces:
  - **The `supplier_confirmation` approval handler:**
    - **Approve:** needs `expectedDispatchDate` (`YYYY-MM-DD`, not before today in MYT; 400 otherwise). The order becomes `confirmed`, with `confirmedAt` and the date; the round becomes `confirmed`. It logs `supplier_order.confirmed` and emits `supplier_order.confirmed`.
    - **Reject:** needs a reason. The order becomes `rejected_by_supplier`, then `cancelRoundWithRefunds(by 'supplier')`. Ops are notified: `{Supplier name} rejected the {shortName} order: {reason}.` It logs `supplier_order.rejected_by_supplier` and emits `supplier_order.rejected`.
  - `markDispatched(deps, caller, supplierOrderId)`: the own supplier only (another supplier gets 404); the order must be `confirmed`, otherwise 409. The order and the round become `dispatched`; it logs and emits `supplier_order.dispatched`.
  - Views. None of them contain shop names or ids:
    - `SupplierOrderView = { supplierOrderId; roundId; productName; packDescription; unitName; quantity; unitPriceSen; totalSen; hubName; requiredDispatchDate; expectedDispatchDate: string | null; status; approvalId: string | null }`
    - `SupplierOpenRoundView = { roundId; productName; cutoffAt; totalQuantity; shopCount; currentTier }`
    - `SupplierProductView = { productId; name; packDescription; unitName; buyAlonePriceSen; tiers: TierView[]; cadence; cutoffWeekday; cutoffTime; active }`
    - `SupplierPayoutView = { supplierOrderId; productName; goodUnits; amountSen; reference; paidAt; simulated: true }`

- [ ] **Step 1: Write the failing tests.** The setup takes the condensed milk order through Ops approval.

```ts
it('shows the supplier one consolidated order with no shop data (stories 103, 104, 145)', async () => {
  const res = await (
    await app.as('farid')
  ).get(`/api/suppliers/${SUP_DRY}/orders?status=awaiting_supplier`);
  expect(res.body.items[0]).toMatchObject({
    productName: 'Sweetened condensed milk 390 g',
    quantity: 105,
    unitPriceSen: 14600,
    totalSen: 1533000,
    hubName: 'Klang Valley hub',
    requiredDispatchDate: '2026-11-07',
  });
  expectNoShopIdentity(res.body, allShopNames(), allShopIds());
});
it('needs a sensible dispatch date to confirm (story 105)', async () => {
  const f = await app.as('farid');
  expect(
    (
      await f.post(`/api/approvals/${supplierApprovalOf(cmOrder)}/approve`, {
        expectedDispatchDate: '2026-11-01',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.post(`/api/approvals/${supplierApprovalOf(cmOrder)}/approve`, {
        expectedDispatchDate: '7 Nov',
      })
    ).status,
  ).toBe(400);
  await f.post(`/api/approvals/${supplierApprovalOf(cmOrder)}/approve`, {
    expectedDispatchDate: '2026-11-07',
  });
  expect(await order(cmOrder)).toMatchObject({
    status: 'confirmed',
    expectedDispatchDate: '2026-11-07',
  });
});
it('tells Ops when a supplier rejects (story 106)', async () => {
  await (
    await app.as('lim')
  ).post(`/api/approvals/${supplierApprovalOf(eggAOrder)}/reject`, { reason: 'out of stock' });
  expect(await lastWhatsapp('nadia', 'ops.supplier_rejected')).toBe(
    'Ladang Telur Contoh rejected the Grade A eggs order: out of stock.',
  );
  expect(await lastWhatsapp('ahSeng', 'owner.order_rejected', 'Grade A eggs')).toMatch(
    /^The supplier couldn't fill Grade A eggs this week\. Full refund: RM [\d,.]+\.$/,
  );
});
it("hides another supplier's order", async () => {
  expect(
    (await (await app.as('lim')).post(`/api/supplier-orders/${cmOrder}/dispatched`)).status,
  ).toBe(404);
});
it('marks the order dispatched (story 107)', async () => {
  /* farid → 200; order and round 'dispatched'; a second call → 409 */
});
it('shows open round totals and shop counts only (story 110)', async () => {
  const res = await (await app.as('farid')).get(`/api/suppliers/${SUP_DRY}/rounds?status=open`);
  expectNoShopIdentity(res.body, allShopNames(), allShopIds());
  expect(res.body.items.every((r: any) => typeof r.shopCount === 'number')).toBe(true);
});
it('lists the supplier’s products and tiers read-only (story 109)', async () => {
  /* 6 products for SUP_DRY with tiers */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(supplier): confirm, reject and dispatch in the supplier portal`

---

### Task 3: The hub check, shortfall refunds and the payout

**Files:**

- Create: `src/server/modules/supplier-orders/hub-check.ts`, `src/app/api/supplier-orders/[id]/hub-check/route.ts`
- Modify: `src/server/modules/notifications/templates.ts` (`owner.shortfall`, `supplier.payout`)
- Test: `tests/api/hub-check.test.ts`

**Interfaces:**

- Produces:
  - `previewHubCheck(deps, caller, supplierOrderId, input: { goodUnits: number; damagedUnits: number; notes?: string }): Promise<HubCheckPreview>`. Ops only; no writes.
    - `HubCheckPreview = { orderedQuantity; receivedCounted; excessUnits; excessFlag; allocations: { participationId; shopName; joinedAt; quantity; allocated; missing; refundSen }[]; supplierPayableSen; feeRevenueSen; logisticsPayableSen; shortfallRefundSen }`
  - `recordHubCheck(deps, caller, supplierOrderId, input): Promise<HubCheckView>`. Ops only; the order must be `dispatched` (otherwise 409, including a second check). In one transaction:
    1. Engine `allocateShortfall` over the `kept` participations; `goodUnitsReceived` is capped at `acceptedQuantity`.
    2. `Allocation` rows. Participations become `allocated`, or `shorted` when allocated is 0.
    3. Shortfall refunds: `refund_shortfall`, and the owner message `The supplier delivered short. {units} of {shortName} refunded: {RM}.`, aggregated per shop.
    4. Settlement postings: `settlement_supplier`, `settlement_fee`, `settlement_logistics`. Zero amounts are skipped.
    5. `payments.payout(...)`, then `supplier_payable → partner_cash` (`supplier_payout`).
    6. `HubCheck` row.
    7. The order becomes `settled`; the round `at_hub`.
    8. Logs: `hub.check_recorded`, `hub.shortfall_allocated` (when there's a shortfall), `hub.supplier_payout_released`.
    9. Events: `hub_check.recorded { supplierOrderId, goodUnits, damagedUnits, shortfall }`, `supplier_payout.released { supplierId, supplierOrderId, amountSen }`, and `refund.issued { kind: 'shortfall' }`.
    10. The supplier is notified: `Payment released: {RM} for {units} (simulated).`
    11. **M7 extension point:** an empty `planConsignmentsAndPickups(ctx, roundId)` call placed after the allocations are written.
  - The route: `POST /api/supplier-orders/{id}/hub-check` with `?preview=true` for the preview.

- [ ] **Step 1: Write the failing tests.** The condensed milk order is dispatched.

```ts
it('pays the supplier RM 15,330.00 for 105 good cartons (stories 108, 123)', async () => {
  await nadia.post(`/api/supplier-orders/${cmOrder}/hub-check`, {
    goodUnits: 105,
    damagedUnits: 0,
  });
  expect(await balanceOf(app.prisma, { kind: 'round_hold', roundId: cmRound })).toBe(0);
  expect((await round(cmRound)).status).toBe('at_hub');
  expect(await lastWhatsapp('farid', 'supplier.payout')).toBe(
    'Payment released: RM 15,330.00 for 105 cartons (simulated).',
  );
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
});
it('previews a 5-carton shortfall falling on the last joiner (story 122)', async () => {
  const p = (
    await nadia.post(`/api/supplier-orders/${cmOrder}/hub-check?preview=true`, {
      goodUnits: 100,
      damagedUnits: 5,
    })
  ).body;
  expect(p.allocations.at(-1)).toMatchObject({
    shopName: 'Kedai Kopi Contoh',
    allocated: 1,
    missing: 5,
    refundSen: 75925,
  });
  expect(p.supplierPayableSen).toBe(1460000);
  expect(await app.prisma.hubCheck.count()).toBe(0); // preview writes nothing
});
it('refunds the shortfall and tells the owner why (stories 174–176)', async () => {
  await nadia.post(`/api/supplier-orders/${cmOrder}/hub-check`, {
    goodUnits: 100,
    damagedUnits: 5,
  });
  expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({
    status: 'allocated',
    finalAllInSen: 15185,
  });
  expect(await lastWhatsapp('ahSeng', 'owner.shortfall')).toBe(
    'The supplier delivered short. 5 cartons of condensed milk refunded: RM 759.25.',
  );
});
it('caps and flags more units than ordered', async () => {
  /* goodUnits 110 → excessUnits 5, payout 1533000 */
});
it('refunds everyone and pays nothing when no good units arrive', async () => {
  /* goodUnits 0 → all 'shorted', no settlement or payout postings, hold 0 */
});
it('refuses a second hub check', async () => {
  /* second POST → 409; one payout posting */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(hub): record hub checks with first-come shortfalls and simulated payouts`

---

### Task 4: Rounds board, round detail and money overview

**Files:**

- Create: `src/server/modules/ops/rounds-board.ts`, `src/server/modules/ops/money.ts`, `src/lib/views/ops.ts`, `src/app/api/ops/rounds/route.ts`, `src/app/api/ops/rounds/[roundId]/route.ts`, `src/app/api/ops/money/route.ts`
- Test: `tests/api/ops-board-money.test.ts`

**Interfaces:**

- Produces:
  - `opsRoundsBoard(deps, caller, { status?: RoundStatus }): Promise<{ columns: { status: RoundStatus; rounds: OpsRoundCard[] }[]; stats: { successRate: number; averageTier: number | null; averageShopsPerRound: number | null } }>`:
    - `successRate` = rounds that formed (or went further) ÷ closed rounds that weren't empty.
    - `averageTier` and `averageShopsPerRound` are taken over rounds that formed.
  - `opsRoundDetail(deps, caller, roundId): Promise<OpsRoundDetail>`:
    - participants: shop name, quantity, joined time, limit, status, final all-in, refund and allocation
    - the engine result summary
    - the ledger summary: the hold balance and postings by kind
    - the round's money check
  - `moneyOverview(deps, caller): Promise<{ heldPerOpenRound: { roundId; productName; heldSen }[]; refundsByKind: Record<string, number>; supplierPayoutsSen; feeRevenueSen; logisticsPayableSen; deliveryFeesHeldSen; claimsExpenseSen; partnerCashSen; checks: MoneyCheckResult[] }>`. The checks come from `runMoneyChecks`, and each failure links to `/ops/rounds/<id>`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('groups rounds by status and reports success, tier and shops (story 129)', async () => {
  const b = (await nadia.get('/api/ops/rounds')).body; // after the demo skip: 10 formed, 1 failed, 1 empty
  expect(b.stats.successRate).toBeCloseTo(10 / 11, 5);
  expect(b.stats.averageTier).toBeCloseTo(2.0, 5);
});
it("shows Ops every shop's name in a round (story 131)", async () => {
  const d = (await nadia.get(`/api/ops/rounds/${cmRound}`)).body;
  expect(d.participants.map((p: any) => p.shopName)).toEqual(
    expect.arrayContaining(['Kedai Kopi Contoh', 'Gerai Contoh', 'Kafe Contoh']),
  );
});
it('passes every money check after the full flow (story 130)', async () => {
  /* after the hub check → overview.checks all passed */
});
it('shows a failing check with a link to the round', async () => {
  // admin inserts a posting round_hold → shop_balance for the CM round without updating balances
  const o = (await nadia.get('/api/ops/money')).body;
  expect(o.checks.find((c: any) => c.id === 'cached_balances_match_postings')).toMatchObject({
    passed: false,
  });
});
it('keeps the board and money overview from other roles', async () => {
  /* ahSeng, farid → 403 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ops): rounds board, round detail and the money overview`

---

### Task 5: Ops and supplier screens

**Files:**

- Create:
  - Ops pages: `src/app/(shell)/ops/page.tsx` (approvals inbox), `src/app/(shell)/ops/rounds/page.tsx`, `src/app/(shell)/ops/rounds/[roundId]/page.tsx`, `src/app/(shell)/ops/supplier-orders/[id]/page.tsx`, `src/app/(shell)/ops/money/page.tsx`
  - Supplier pages: `src/app/(shell)/supplier/page.tsx`, `src/app/(shell)/supplier/orders/[id]/page.tsx`, `src/app/(shell)/supplier/rounds/page.tsx`, `src/app/(shell)/supplier/products/page.tsx`, `src/app/(shell)/supplier/payouts/page.tsx`
  - Components: `src/components/ops/*`, `src/components/supplier/*`
- Modify: `src/app/(shell)/activity/page.tsx` (Ops gets a "Verify log" button with its result)

- [ ] **Step 1: Build the Ops screens.**
  - **Inbox:** supplier orders and claims, the latter shown empty until M8.
  - **Approval panel:** what, how much, why, the evidence (product, tier, quantity, shops, money held vs order cost + fees + shipping), the money check as ✅ or ❌, and who proposed it (system). "Approve" and "Reject" buttons; the reason is required for a reject.
  - **Supplier order page:** a hub-check form (good units, damaged units, notes), then "Preview allocation" (a table in join order with refunds), then "Confirm". It shows the simulated payout reference.
  - **Rounds board:** columns by status, and the stats.
  - **Round detail:** the PRD §22 table.
  - **Money overview:** ✅ or ❌ checks with links.
- [ ] **Step 2: Build the supplier screens.**
  - **Orders:** each order offers "Confirm" (with a dispatch date picker), "Reject" (with a reason) and "Mark dispatched".
  - **Open rounds:** totals and shop counts.
  - **Products and tiers:** read-only.
  - **Payouts:** labelled "Simulated".
- [ ] **Step 3: Verify** with Chrome DevTools, Ops at 1280 × 800 and the supplier at 390 × 844, after `pnpm db:reset`:
  1. Ah Seng pays; skip to cut-off.
  2. Nadia approves condensed milk. Expected: 105 cartons, RM 15,330.00, 9 shops, money check ✅.
  3. Farid confirms with a dispatch date, then marks the order dispatched.
  4. Nadia runs the hub check: 105 good, preview, confirm.
  5. Expected: the payout shows "Simulated"; the money overview is all ✅; "Verify log" shows ✅.
- [ ] **Step 4:** Run `pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ui): add Ops approvals, hub check, rounds, money and the supplier portal`

---

### Milestone verification

- [ ] Run `pnpm verify`, then `pnpm db:reset` and the Task 5 walkthrough.
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 65, 103–112, 117–123, 129–131, 176).
