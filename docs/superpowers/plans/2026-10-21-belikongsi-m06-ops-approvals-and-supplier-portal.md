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

- [x] **Step 1:** The branch `m06-ops-approvals-and-supplier-portal` already exists and is checked out.
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
- Modify (test helpers): `tests/api/helpers/scans.ts` (add `expectNoShopIdentity`); `tests/api/helpers/scenarios.ts` (add `toFormed`, `order(id)`, `round(id)`, `opsApprovalOf(supplierOrderId)`, `supplierApprovalOf(supplierOrderId)`, `allShopNames()`, `allShopIds()` and `SUP_DRY = seedId('supplier', 'SUP_DRY')`; `participationOf`, `feeChargeOf`, `roundOf`, `supplierOrderOf`, `lastWhatsapp` and `countWhatsapp` already exist). `balanceOf` comes from `@/server/modules/ledger/accounts`
- Modify: `src/server/modules/notifications/templates.ts` (`supplier.new_order`, `owner.order_rejected`)
- Test: `tests/api/ops-decision.test.ts`

**Interfaces:**

- Produces:
  - **The `supplier_order` approval handler:**
    - **Approve:** the order becomes `awaiting_supplier` and the round `ordered`. It creates the approval `supplier_confirmation` (assignee `supplier`, `supplierId`, amount = total), logs `supplier_order.approved` and emits `supplier_order.approved { supplierOrderId, roundId, supplierId, quantity, totalSen }`. It notifies the supplier (audience `{ supplierId, roles: ['supplier'] }`): `New BeliKongsi order: {units} of {shortName} for the {hubLabel}. Please confirm.` Here `{hubLabel}` is `` `${hub.region} hub` `` (`Klang Valley hub`), because `Hub.name` is the longer `Klang Valley hub (Shah Alam, Selangor)`. `hubName` in `SupplierOrderView` uses the same label. It also sets `supplierApprovalId` on the order. The handler registers through `registerApprovalHandler('supplier_order', …)`, and `createApproval` already takes `supplierId` and `assigneeRole: 'supplier'`.
    - **Reject:** the order becomes `rejected_by_ops`, then `cancelRoundWithRefunds(ctx, roundId, { by: 'ops', reason })`, and it logs `supplier_order.rejected_by_ops`.
  - `cancelRoundWithRefunds(ctx, roundId, input: { by: 'ops' | 'supplier'; reason: string }): Promise<{ refundedSen: number }>`:
    - Every `kept` participation becomes `refunded_round_cancelled`, posting `round_hold → shop_balance` (`refund_round_cancelled`) for its `finalAllInSen × quantity`, so the hold ends at 0.
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
  // The approve route only admits supplier and ops sessions, so an owner is refused with 403.
  expect(
    (await (await app.as('ahSeng')).post(`/api/approvals/${opsApprovalOf(cmOrder)}/approve`, {}))
      .status,
  ).toBe(403);
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
    - **Approve:** needs `expectedDispatchDate` (`YYYY-MM-DD`, not before today in MYT, using `mytDate(ctx.now)` from `src/lib/time.ts`; 400 `badRequest` otherwise). The approve route's schema (`z.iso.date().optional()`) already rejects a malformed date with 400 and passes the value to the handler as `input.expectedDispatchDate`; the handler throws 400 when it is missing or in the past, and the transaction rolls back. A reject without a reason is already refused by `decideApproval` with 422 `REASON_REQUIRED`. The order becomes `confirmed`, with `confirmedAt` and the date; the round becomes `confirmed`. It logs `supplier_order.confirmed` and emits `supplier_order.confirmed`.
    - **Reject:** needs a reason. The order becomes `rejected_by_supplier`, then `cancelRoundWithRefunds(by 'supplier')`. Ops are notified (audience `{ operator: true, roles: ['ops'] }`): `{Supplier name} rejected the {shortName} order: {reason}.` It logs `supplier_order.rejected_by_supplier` and emits `supplier_order.rejected`.
  - `markDispatched(deps, caller, supplierOrderId)`: the own supplier only (another supplier gets 404); the order must be `confirmed`, otherwise 409. The order and the round become `dispatched`; it logs and emits `supplier_order.dispatched`.
  - Views. None of them contain shop names or ids:
    - Supplier route guard: `requireSupplierAccess(caller, supplierId)` from `src/server/platform/permissions.ts` (another supplier gets 404, owners and staff 403). For `/api/supplier-orders/[id]/dispatched`, look up the order and answer 404 when it belongs to another supplier.
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
    1. Engine `allocateShortfall({ kept: [{ id, quantity, joinedAt (ISO), final: { goodsSen, feeSen, shippingSen, allInSen } }], goodUnitsReceived, finalGoodsPriceSen })` over the `kept` participations (`final` is built from `finalGoodsSen`, `finalFeeSen`, `unitShippingSen` and `finalAllInSen`; `finalGoodsPriceSen` is `round.finalUnitPriceSen`). The engine already caps the count at the ordered quantity (`receivedCounted`) and reports `excessUnits` and `excessFlag`; lock the round `FOR UPDATE` first, then the kept participations, then the shops in id order (the payments lock order). It returns `AllocationResult[]` of `{ id, allocated, missing, refundSen }` where `id` is the participation id.
    2. `Allocation` rows. Participations become `allocated`, or `shorted` when allocated is 0.
    3. Shortfall refunds: `refund_shortfall`, and the owner message `The supplier delivered short. {units} of {shortName} refunded: {RM}.`, aggregated per shop.
    4. Settlement postings: `settlement_supplier`, `settlement_fee`, `settlement_logistics`. Zero amounts are skipped.
    5. `deps.payments.payout({ supplierOrderId, supplierId, amountSen }) → { reference }` (the simulated partner; call it even for 0 so `HubCheck.payoutReference` is set, but post nothing for 0), then `supplier_payable → partner_cash` (`supplier_payout`).
    6. `HubCheck` row (`goodUnits`, `damagedUnits`, `notes`, `checkedByUserId`, `checkedAt`, `receivedCounted`, `shortfallUnits`, `excessUnits`, `payoutSen`, `payoutReference`). The `refund_*` postings carry `participationId` and come from the round hold, which the money check `participation_paid_equals_refunds_plus_allocated` relies on.
    7. The order becomes `settled`; the round `at_hub`.
    8. Logs: `hub.check_recorded`, `hub.shortfall_allocated` (when there's a shortfall), `hub.supplier_payout_released`.
    9. Events: `hub_check.recorded { supplierOrderId, goodUnits, damagedUnits, shortfall }`, `supplier_payout.released { supplierId, supplierOrderId, amountSen }`, and `refund.issued { kind: 'shortfall' }`.
    10. The supplier is notified: `Payment released: {RM} for {units} (simulated).`
    11. **M7 extension point:** `planConsignmentsAndPickups` does not exist yet (there is no `fulfilment` module). Leave a comment at that point in `recordHubCheck` for M7; do not add an empty stub export.
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
  - Task 0 note: the figures in the first Task 4 test (10 formed, 1 failed, 1 empty; `averageTier` 2.0) are not confirmed against the code. Check them against the real board after the demo skip, and fix the test numbers, not the formula.
  - `moneyOverview(deps, caller): Promise<{ heldPerOpenRound: { roundId; productName; heldSen }[]; refundsByKind: Record<string, number>; supplierPayoutsSen; feeRevenueSen; logisticsPayableSen; deliveryFeesHeldSen; claimsExpenseSen; partnerCashSen; checks: MoneyCheck[] }>`. `MoneyCheck = { id: MoneyCheckId; label; passed; failures: { roundId?; participationId?; detail }[] }` comes from `runMoneyChecks(prisma): Promise<MoneyReport>` (`{ allPassed, checks }`) in `ledger/checks.ts`, and each failure with a `roundId` links to `/ops/rounds/<id>`.

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
  - Ops pages: `src/app/(shell)/ops/page.tsx` (exists as a placeholder; replace it with the approvals inbox), `src/app/(shell)/ops/rounds/page.tsx`, `src/app/(shell)/ops/rounds/[roundId]/page.tsx`, `src/app/(shell)/ops/supplier-orders/[id]/page.tsx`, `src/app/(shell)/ops/money/page.tsx`
  - Supplier pages: `src/app/(shell)/supplier/page.tsx` (exists as a placeholder; replace it), `src/app/(shell)/supplier/orders/[id]/page.tsx`, `src/app/(shell)/supplier/rounds/page.tsx`, `src/app/(shell)/supplier/products/page.tsx`, `src/app/(shell)/supplier/payouts/page.tsx`
  - Components: `src/components/ops/*`, `src/components/supplier/*`
- Note: the Ops "Verify log" button already exists on `src/app/(shell)/activity/page.tsx` (`VerifyLogButton`); only link to it.

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
