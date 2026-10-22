# M7 Fulfilment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the hub check, goods travel as consignments to pickup points or doors. Ops clicks the simulated partner's status updates. Each shop gets one pickup per place and date with a 6-digit code, which becomes ready only when all of its goods have arrived. Staff collect with the code, background shops are handled automatically, and "Complete other rounds" fast-forwards everything except the featured round.

**Architecture:**

- `planConsignmentsAndPickups` fills M6's extension point in `recordHubCheck`. It groups allocations into planned consignments, in waves (C3), and per-shop pickups.
- `refreshPickupReadiness` applies C4 whenever a hub check or a consignment status change could affect a pickup.
- Consignment updates are the only way goods move.
- They also trigger the delivery-fee handover and the background-shop automation.

**Tech Stack:** the M2 platform services, the M4 ledger helpers, `@vis.gl/react-google-maps` for the network map.

**Spec:** PRD §5 (consignment and pickup states), §6.9, §8 ("Door consignment dispatched"), §9 ("Complete other rounds"), §10, §13 (ready, out for delivery), §20 (pickups, consignments), §22 (pickups, staff deliveries, consignments board, map), §23 (demo step 4), stories 69–73, 100, 124–126, 133, 165; build design C3, C4, C12.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §10:
  - consignments are created at each hub check, one per hub, destination and delivery date (waves per C3)
  - Ops moves them through dispatched → arrived (pickup point), or out for delivery → delivered (door)
  - a pickup is one per shop, destination and delivery date, and combines rounds
  - its 6-digit code is random and unique among open pickups at that destination
- PRD §8: when a door consignment is dispatched, the delivery fee moves `delivery fee hold → logistics payable`, once per shop and date.
- PRD §13 texts (owner and staff):
  - "Ready at Ipoh pickup point (10 am–7 pm daily). Pickup code 482 913."
  - "Your goods are out for delivery today. Have code 482 913 ready."
- PRD §10 background shops: when a consignment arrives or is delivered, background shops' pickups are collected automatically, with the actor "system" and the reason "background shop simulation". M8 adds the automatic "All received" check.
- PRD §9 "Complete other rounds" runs every formed round except the featured one, with the actor "system" and the reason "Demo simulation".
- Status changes that skip a step return 409 (PRD §20).

## Review Focus

1. **A code collision between two open pickups at the same pickup point:** generation retries until the code is unique, never fails or reuses one. Pinned in Task 1.
2. **A wrong code typed at the counter:** 422 `WRONG_CODE`, with the pickup unchanged. A correct code on a pickup that isn't ready gets 409. Pinned in Task 4.
3. **Ops clicks "arrived" on a consignment that was never dispatched:** 409, and no readiness change. Pinned in Task 2.
4. **Two door consignments for one shop and date** (two hubs): the delivery fee moves to the partner only once. Pinned in Task 2.
5. **"Complete other rounds" clicked twice:** the second run changes nothing (idempotent). Pinned in Task 5.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m07-fulfilment`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names:
  - M6: `recordHubCheck` and its `planConsignmentsAndPickups` extension point, the `supplier_order` and `supplier_confirmation` handlers, `markDispatched`, `decideApproval`.
  - M5: `refundDeliveryFeeIfUnused`, `skipToCutoff`.
  - M3: `simulatedLogistics.newConsignmentReference`.
  - M2: `TEMPLATES`, `formatPickupCode`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Consignments and pickups at the hub check

**Files:**

- Create: `src/server/modules/fulfilment/plan.ts`, `src/server/modules/fulfilment/codes.ts`, `src/server/modules/fulfilment/readiness.ts`
- Modify:
  - `src/server/modules/supplier-orders/hub-check.ts`: call `planConsignmentsAndPickups`.
  - `src/server/modules/notifications/templates.ts`: `pickup.ready`, `pickup.out_for_delivery`, `pickup.delivered`.
  - `tests/api/helpers/scenarios.ts`: add `toHubChecked(app, productKeys)`, `consignmentFor`, `pickupOf`, `allocationOf`, `moveConsignment`. Existing helpers (`toFormed(app)`, `roundOf`, `feeChargeOf`, `lastWhatsapp`, `participationOf`, `opsApprovalOf`, `supplierApprovalOf`, `supplierOrderOf`) read through the module-level `getDeps()`. Only the ones that sign in or pay (`toFormed`, `setupKedaiKopi`, `payBasket`) take `app`, so the new lookup helpers take no `app`; `toHubChecked(app, …)` and `moveConsignment` (it signs in as `nadia`) do take it. `toHubChecked` follows the `beforeEach` of `tests/api/hub-check.test.ts`: approve with `POST /api/approvals/:id/approve {}` as `nadia`, `POST /api/approvals/:id/approve { expectedDispatchDate: '2026-11-07' }` and `POST /api/supplier-orders/:id/dispatched` as `farid`, then `POST /api/supplier-orders/:id/hub-check`. Seed keys: hubs `HUB_KV`, `HUB_JOHOR`; pickup points `PP_IPOH`, `PP_JB`, `PP_KUANTAN`, `PP_PJ`, `PP_SEREMBAN`, `PP_MELAKA`; shops `KEDAI_KOPI`, `GERAI` (door), `KAFE`, background `BG01`…`BG40` (`BGnn` is at the pickup point `(nn-1) mod 6` in that order, so `BG01` is at Ipoh; every fifth is door).
- Test: `tests/api/fulfilment-plan.test.ts`

**Interfaces:**

- Produces:
  - `destinationKeyOf(p: { destinationType: DestinationType; pickupPointId: string | null; shopId: string }): string`. It returns `pp:<pickupPointId>` for a pickup point and `door:<shopId>` for door delivery.
  - `planConsignmentsAndPickups(ctx, roundId): Promise<{ consignmentIds: string[]; pickupIds: string[] }>`. For each allocation with `allocated > 0`:
    - It joins the `planned` consignment for (hub, destination key, delivery date), or creates the next wave (C3; unique on `hubId, destinationKey, deliveryDate, wave`) with `partnerReference = ctx.deps.logistics.newConsignmentReference()` (`SIM-` plus 8 hex characters, not `SIM-LOG-…`), `statusHistory = [{ status: 'planned', at, actor }]`, `shopId` set for a door consignment (null for a pickup point), and logs `fulfilment.consignment_created`.
    - It joins or creates the shop's pickup for (destination key, date), with status `waiting`, and sets both `allocation.consignmentId` and `allocation.pickupId` (neither column has a foreign key; M6 creates the allocation rows with both null before the extension point).
    - Shorted participations (status `shorted`, `allocated = 0`) get no consignment, and `refundDeliveryFeeIfUnused` runs for them. M6 has already set their status inside the same transaction, and `refundDeliveryFeeIfUnused(ctx, shopId, deliveryDate)` counts only `active/kept/allocated/received/closed` as heading for delivery, so the order is safe.
  - `newPickupCode(ctx, destinationKey): Promise<string>`: 6 random digits from `crypto.randomInt(0, 1_000_000)` zero-padded. The partial unique index `pickups_open_code_per_destination` (`destination_key, code WHERE status <> 'closed'`) already exists. Do NOT retry by catching the unique violation: that aborts the whole Postgres transaction. Instead read the codes of the destination's non-`closed` pickups first, and draw again while the code is in that set (the test stubs `randomInt` to return an existing code first).
  - `refreshPickupReadiness(ctx, pickupIds: string[]): Promise<void>`, the C4 rule:
    - **Gate 1:** no participation of that shop, destination key and date is `active` or `kept` (after a hub check a round's participations are `allocated` or `shorted`, so only rounds not yet hub-checked hold a pickup back).
    - **Gate 2:** every consignment carrying its allocations is `arrived` (for a pickup point), or `out_for_delivery`/`delivered` (for door).
    - **When both gates hold:**
      - a pickup-point pickup becomes `ready`, with `readyAt`; it notifies owner and staff with `pickup.ready`, logs `fulfilment.pickup_ready` and emits `pickup.ready { pickupId, shopId, destinationType, deliveryDate }`
      - a door pickup becomes `out_for_delivery`, and later `delivered`, with the matching notices
  - Notice texts. A template is declared in `src/server/modules/notifications/templates.ts` inside `defineTemplates({...})` as `'type': (data: {...}) => (role: Role) => ({ title, body, whatsappText })`, and is called as `notify(ctx, { type, audience: { shopId, roles: ['owner', 'staff'] }, link, message: TEMPLATES['type'](data), dedupeKey })` (import `notify, TEMPLATES` from `notifications/notify`). Staff text must not match `RM\s?\d`, and WhatsApp text is at most 300 characters.
    - `pickup.ready`: `Ready at {pickup point name} ({openingHours}). Pickup code {formatPickupCode(code)}.`
    - `pickup.out_for_delivery`: `Your goods are out for delivery today. Have code {formatPickupCode(code)} ready.`
    - `pickup.delivered`: `Your goods were delivered. Please check them now.`

- [ ] **Step 1: Write the failing tests.** The setup helper `toHubChecked(app, ['CM'])` takes the demo through payment, cut-off, approvals, dispatch and a hub check of 105 good units for the named rounds.

```ts
it('groups condensed milk into a planned consignment to the Ipoh pickup point', async () => {
  const c = await consignmentFor({
    hub: 'HUB_KV',
    destinationKey: `pp:${PP_IPOH}`,
    deliveryDate: '2026-11-10',
  });
  expect(c).toMatchObject({ status: 'planned', wave: 1 });
  expect(await allocationOf('KEDAI_KOPI', 'CM')).toMatchObject({
    allocated: 6,
    consignmentId: c.id,
  });
});
it('gives each shop one pickup per place and date with a 6-digit code (stories 69, 73)', async () => {
  const p = await pickupOf('KEDAI_KOPI', '2026-11-10');
  expect(p.code).toMatch(/^\d{6}$/);
  expect(p.status).toBe('waiting');
});
it('keeps a pickup waiting while other rounds for that date have not reached the hub (C4)', async () => {
  await moveConsignment(c.id, 'dispatched');
  await moveConsignment(c.id, 'arrived');
  expect((await pickupOf('KEDAI_KOPI', '2026-11-10')).status).toBe('waiting'); // OIL, EGG_A, COFFEE, CUPS still 'kept'
});
it('starts a new consignment wave once the first has left (C3)', async () => {
  // hub-check OIL first → KV→Ipoh wave 1; dispatch it; hub-check CM → KV→Ipoh wave 2 'planned'
});
it('retries a pickup code that collides at the same destination', async () => {
  /* stub randomInt to return an existing code first → a different code is stored */
});
it('logs consignment creation by the system', async () => {
  /* fulfilment.consignment_created, actorType 'system' */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fulfilment): plan consignments and pickups at the hub check`

---

### Task 2: Partner status updates and the delivery fee handover

**Files:**

- Create: `src/server/modules/fulfilment/consignments.ts`, `src/app/api/consignments/[id]/status/route.ts`, `src/app/api/ops/consignments/route.ts`
- Test: `tests/api/consignments.test.ts`

**Interfaces:**

- Produces:
  - `updateConsignmentStatus(deps, caller, consignmentId, status: 'dispatched' | 'arrived' | 'out_for_delivery' | 'delivered'): Promise<ConsignmentView>`. Ops or system only.
    - **Allowed moves:** `planned → dispatched`; `dispatched → arrived` (pickup point only); `dispatched → out_for_delivery → delivered` (door only). Anything else gets 409 `INVALID_TRANSITION`.
    - It appends `{ status, at, actor }` to `statusHistory`.
    - **On a door `dispatched`:** for each shop and date with a `held` charge, it posts `delivery_fee_hold → logistics_payable` (`delivery_fee_to_partner`), and the charge becomes `passed_to_partner`.
    - **Afterwards:** `refreshPickupReadiness` for the linked pickups, then the background automation (Task 3).
    - It logs `fulfilment.consignment_status_changed` and emits `consignment.status_changed { consignmentId, hubId, destinationType, destinationId, status }`.
  - `listConsignments(deps, caller, { status? }): Promise<ConsignmentView[]>` (Ops).
    - `ConsignmentView = { consignmentId; hubName; hubLatLng; destinationType; destinationName; destinationLatLng; deliveryDate; wave; status; statusHistory; itemCount; containsFeaturedRound: boolean; partnerReference }`
    - `containsFeaturedRound` is computed, not stored (`Round` has no featured flag): the feature is `DemoSettings.featuredProductId` (read through `getDemoState(deps).featuredRoundId` in `modules/demo/demo.ts`, the open round of that product, else its latest). A consignment contains it when any allocation linked by `consignmentId` belongs to a participation of that round.
    - The event types `consignment.status_changed`, `pickup.ready` and `pickup.collected` and the action codes `fulfilment.*` and `demo.complete_other_rounds` already exist in `EventType` and `ACTIONS`; nothing to add. Event data keys must not match `/name|phone|email|address/`. The ledger kind `delivery_fee_to_partner` and the accounts `delivery_fee_hold { shopId, deliveryDate }` and `logistics_payable` also exist; take the shop lock (`lockShop` from `payments/fee`) before the posting, as `refundDeliveryFeeIfUnused` does.

- [ ] **Step 1: Write the failing tests:**

```ts
it('refuses a step that skips the order (409)', async () => {
  expect((await nadia.post(`/api/consignments/${c.id}/status`, { status: 'arrived' })).status).toBe(
    409,
  );
});
it('refuses door-only steps for a pickup point', async () => {
  /* planned → dispatched → out_for_delivery → 409 */
});
it("hands Gerai Contoh's delivery fee to the partner once at dispatch (PRD §8)", async () => {
  await nadia.post(`/api/consignments/${geraiDoor.id}/status`, { status: 'dispatched' });
  expect(await feeChargeOf('GERAI', '2026-11-10')).toMatchObject({ status: 'passed_to_partner' });
  expect(await balanceOf(app.prisma, { kind: 'logistics_payable' })).toBe(logisticsBefore + 1200);
});
it('moves the fee only once when two door consignments go to one shop', async () => {
  /* a second door consignment for GERAI on the same date dispatched → logistics payable unchanged */
});
it('makes the pickup ready once every consignment has arrived and tells owner and staff (story 70)', async () => {
  // all of Kedai's rounds hub-checked; dispatch and arrive both Ipoh consignments
  const p = await pickupOf('KEDAI_KOPI', '2026-11-10');
  expect(p.status).toBe('ready');
  expect(await lastWhatsapp('rahim', 'pickup.ready')).toBe(
    `Ready at Ipoh pickup point (10 am–7 pm daily). Pickup code ${formatPickupCode(p.code)}.`,
  );
  expect(await lastWhatsapp('ahSeng', 'pickup.ready')).toBe(
    `Ready at Ipoh pickup point (10 am–7 pm daily). Pickup code ${formatPickupCode(p.code)}.`,
  );
});
it('tells a door shop when its goods are out for delivery (story 72)', async () => {
  /* GERAI → "Your goods are out for delivery today. Have code 123 456 ready." */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fulfilment): simulate partner statuses and hand over delivery fees`

---

### Task 3: Background shops collect automatically

**Files:**

- Create: `src/server/modules/fulfilment/background.ts`
- Modify: `src/server/modules/fulfilment/consignments.ts`
- Test: `tests/api/background-automation.test.ts`

**Interfaces:**

- Produces: `runBackgroundAutomation(ctx, pickupIds: string[]): Promise<number>`.
  - For background shops' (`Shop.isBackground`) pickups that are `ready` (pickup point) or `out_for_delivery` (door): mark them `collected` or `delivered`, with `systemCaller('background shop simulation')`. A `PickupStatus.delivered` pickup is already final, so `delivered` is the result here, not an input.
  - M8 extends this function with the automatic "All received" check.

- [ ] **Step 1: Write the failing test:**

```ts
it('collects background shops’ pickups automatically, labelled as simulation (story 133)', async () => {
  // arrive the KV→Ipoh consignment that carries background Ipoh shops
  const bg = await pickupOf(BG_IPOH_SHOP, '2026-11-10');
  expect(bg.status).toBe('collected');
  const e = await app.prisma.activityLogEntry.findFirstOrThrow({
    where: { action: 'fulfilment.pickup_collected', subjectId: bg.id },
  });
  expect(e).toMatchObject({ actorType: 'system', reason: 'background shop simulation' });
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fulfilment): automate background shops’ pickups`

---

### Task 4: Collecting with the code, and the pickup tracker

**Files:**

- Create: `src/server/modules/fulfilment/pickups.ts`, `src/lib/views/pickups.ts`, `src/app/api/pickups/[pickupId]/collect/route.ts`, `src/app/api/shops/[shopId]/pickups/route.ts`
- Test: `tests/api/pickups.test.ts`

**Interfaces:**

- Produces:
  - `collectPickup(deps, caller, pickupId, { code }): Promise<PickupView>`. Owner or staff of the shop only.
    - A wrong code gets 422 `WRONG_CODE`.
    - A ready pickup-point pickup becomes `collected`, logging `fulfilment.pickup_collected`.
    - An `out_for_delivery` door pickup becomes `delivered`, logging `fulfilment.delivered`.
    - Any other state gets 409 `NOT_READY`.
    - It emits `pickup.collected { pickupId, shopId, destinationType, deliveryDate }`.
    - A pickup-point consignment becomes `completed` once all of its pickups are collected.
  - `listShopPickups(deps, caller, shopId, { status?: 'upcoming' | 'past' }): Promise<{ items: PickupView[] }>` (owner and staff).
    - It includes "upcoming" groups built from kept participations that don't have a pickup yet.
    - `PickupView = { pickupId: string | null; destinationType; placeName: string | null; address: string | null; openingHours: string | null; deliveryDate; status; statusLabel; code: string | null; lines: { allocationId: string | null; productName; unitName; quantity }[] }`.
    - It contains no money, for anyone (R6).
    - `statusLabel` (story 71): "Waiting for supplier", "On its way to the hub", "At the hub", "On the way", "Ready for pickup", "Collected", "Out for delivery" or "Delivered".

- [ ] **Step 1: Write the failing tests:**

```ts
it('refuses a wrong code and leaves the pickup ready', async () => {
  expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: '000000' })).status).toBe(422);
  expect((await pickupOf('KEDAI_KOPI', '2026-11-10')).status).toBe('ready');
});
it('marks the handover with the right code (story 76)', async () => {
  expect((await rahim.post(`/api/pickups/${p.id}/collect`, { code: p.code })).body).toMatchObject({
    status: 'collected',
  });
});
it('refuses to collect a pickup that is not ready', async () => {
  /* waiting pickup, correct code → 409 NOT_READY */
});
it('shows staff upcoming pickups with codes and places but no money (stories 100, 99)', async () => {
  const res = await rahim.get(`/api/shops/${KEDAI}/pickups?status=upcoming`);
  expect(res.body.items[0]).toMatchObject({
    placeName: 'Ipoh pickup point',
    openingHours: '10 am–7 pm daily',
  });
  expectNoMoneyFields(res.body);
});
it('labels each stage the way owners read it (story 71)', async () => {
  /* before the hub check → 'Waiting for supplier'; after dispatch → 'On the way'; arrived → 'Ready for pickup' */
});
it("hides another shop's pickups", async () => {
  /* siti GET Kedai pickups → 404; collect → 404 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(fulfilment): collect with a code and track pickups`

---

### Task 5: "Complete other rounds"

**Files:**

- Create: `src/server/modules/demo/complete-other-rounds.ts`, `src/app/api/demo/complete-other-rounds/route.ts`
- Test: `tests/api/complete-other-rounds.test.ts`

**Interfaces:**

- Produces: `completeOtherRounds(deps, caller): Promise<{ rounds: number; consignmentsMoved: number }>`. Demo mode only (`requireDemoMode(deps)` throws 404 `DEMO_OFF`). The route is `POST /api/demo/complete-other-rounds` with `route({ auth: 'session', idempotent: true }, …)`, like `skip-to-cutoff`. The featured round is `getDemoState(deps).featuredRoundId`. As `systemCaller('Demo simulation')`, for every `formed` round except the featured one, each in its own `withTransaction`:
  - **M6 constraint:** `decideApproval` and `markDispatched` accept only a signed-in person (`caller.kind === 'person'`; `markDispatched` also only the order's own supplier), so a system caller cannot use them. Use the handlers directly instead, which take a `TxContext` and an `ApprovalRequest` and check no role: `approveSupplierOrder(ctx, request, input)` (`supplier-orders/ops-decision.ts`) and `confirmSupplierOrder(ctx, request, input)` (`supplier-orders/supplier-decision.ts`; `input.expectedDispatchDate` is a `YYYY-MM-DD` string that must not be before today in MYT). After each, update the `approvalRequest` row to `approved` with `decidedAt = ctx.now`, `decidedByUserId = null` (the column is nullable). For dispatch, extract the body of `markDispatched` after its role checks into an exported `dispatchOrder(ctx, supplierOrderId)` in `supplier-decision.ts`, and have both `markDispatched` and this function call it. `recordHubCheck(deps, caller, supplierOrderId, input)` calls `requireOps`, which a system caller passes.
  1. Approve the `supplier_order` approval (`type: 'supplier_order'`, `subjectId` = the order id; find it with `approvalRequest.findFirst`).
  2. Approve the `supplier_confirmation` approval with `expectedDispatchDate = order.requiredDispatchDate` (cutoff + 2 days, always after the demo clock).
  3. Dispatch the order (`dispatchOrder`).
  4. `recordHubCheck` with `goodUnits = acceptedQuantity` and no damage.
  5. Move every `planned` consignment with `containsFeaturedRound = false` to `dispatched`, then `arrived` (pickup point) or `out_for_delivery` (door).
  6. Log `demo.complete_other_rounds`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('fast-forwards every non-featured round and leaves condensed milk to Ops (story 165)', async () => {
  // demo: pay, skip to cut-off; Ops approves CM, supplier confirms and dispatches, Ops hub-checks CM (105)
  await nadia.post('/api/demo/complete-other-rounds');
  expect((await roundOf('OIL', '2026-W45')).status).toBe('at_hub');
  const kvIpoh = await consignmentFor({
    hub: 'HUB_KV',
    destinationKey: `pp:${PP_IPOH}`,
    deliveryDate: '2026-11-10',
  });
  expect(kvIpoh).toMatchObject({ status: 'planned', containsFeaturedRound: true });
  expect((await pickupOf('KEDAI_KOPI', '2026-11-10')).status).toBe('waiting');
  await moveConsignment(kvIpoh.id, 'dispatched');
  await moveConsignment(kvIpoh.id, 'arrived');
  expect((await pickupOf('KEDAI_KOPI', '2026-11-10')).status).toBe('ready');
});
it('marks every step as demo simulation', async () => {
  /* log entries from this run: actorType 'system', reason 'Demo simulation' */
});
it('does nothing the second time', async () => {
  /* second call → { rounds: 0, consignmentsMoved: 0 } */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(demo): complete the other rounds`

---

### Task 6: Pickup, delivery and network screens

**Files:**

- Create:
  - Owner pages: `src/app/(shell)/owner/pickups/page.tsx`, `src/app/(shell)/owner/pickups/[pickupId]/page.tsx`
  - Staff pages: `src/app/(shell)/staff/deliveries/page.tsx`, `src/app/(shell)/staff/deliveries/[pickupId]/page.tsx`
  - Ops page: `src/app/(shell)/ops/consignments/page.tsx`
  - Components: `src/components/pickups/*`, `src/components/ops/network-map.tsx`, `src/components/ops/consignment-board.tsx`
- Modify: `src/components/shell/demo-menu.tsx` ("Complete other rounds"); `src/app/(shell)/owner/page.tsx` (a next-pickup card with place, date and code)
  - `demo-menu.tsx` is a client component with a `<dialog>` and one `<section>` per action; `busy` is `'reset' | 'skip' | null`, `skipToCutoff` calls `apiFetch('/api/demo/skip-to-cutoff', { method: 'POST', quiet: true })` after a confirmation step, then `toast.success` and `router.refresh()`. Add a `'complete'` busy value and a section in the same style (confirm first), calling `/api/demo/complete-other-rounds`.
  - `src/app/(shell)/staff/deliveries/page.tsx` already exists as an `EmptyState` placeholder ("Confirm delivery"); modify it rather than create it. `src/components/maps/pickup-map.tsx` already uses `@vis.gl/react-google-maps` (installed, `^1.10.1`; key `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`), so reuse its setup for `network-map.tsx`.

- [ ] **Step 1: Owner pickups.** A status tracker per pickup (the story 71 labels), and a large code display formatted "482 913".
- [ ] **Step 2: Staff deliveries.** The list of pickups with code, place and opening hours. A pickup's page offers "Show code", a code entry, and "Collected". The delivery check arrives in M8; until then, show a confirmation "Collected. Next: check your goods (coming soon)".
- [ ] **Step 3: Ops consignments.** A board by status with status buttons, which show only the allowed next steps. The network map shows hubs, pickup points, and consignments coloured by status, with lines from hub to destination. A list view is the fallback.
- [ ] **Step 4: Verify** with Chrome DevTools after `pnpm db:reset`, following the demo script through step 4:
  1. Ah Seng pays; skip to cut-off.
  2. Ops approves condensed milk; Farid confirms and dispatches; Ops hub-checks 105 good.
  3. Complete other rounds.
  4. Ops moves the Ipoh consignments dispatched → arrived.
  5. Rahim sees "Ready" with the code, and collects with it.
  6. The map renders, or falls back to the list.
- [ ] **Step 5:** Run `pnpm verify`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(ui): add pickups, staff deliveries, the consignments board and the network map`

---

### Milestone verification

- [ ] Run `pnpm verify`, then `pnpm db:reset` and the Task 6 walkthrough.
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 69–73, 100, 124–126, 133, 165).
