# M5 Round Close and Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At cut-off every round closes by the engine's rules. Every difference, dropout and failure is refunded to the right balance, owners are told the result in plain English, formed rounds get a supplier order waiting for Ops, the next round opens, and the demo can jump straight to cut-off.

**Architecture:** `closeRoundById` locks one round, runs `closeRound` from the engine, and writes every consequence in the same transaction: participation outcomes, refund postings, delivery-fee refunds, log entries, events, notifications, the supplier-order draft and the next round. `closeDueRounds` loops over due rounds, one transaction each, and joins `runDueJobs`.

**Tech Stack:** Prisma 7 with row locks, the M1 engine, the M2 platform services.

**Spec:** PRD §5 (round and participation states), §6.6, §6.9, §6.11, §8 (postings at cut-off), §9 "Drafting", §13 (round results, approval needed), §20 (participations list, demo skip, ops events), §21, §23 (demo step 3), stories 59, 61–64, 66, 68, 94, 132, 160, 164, 177; build design C7, C12, R11; index §5.8.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §8 cut-off postings: kept → `round hold → shop balance` (the difference); dropped or failed → `round hold → shop balance` (the full amount).
- PRD §6.9: the delivery fee is refunded when every participation attached to that door delivery is refunded before dispatch.
- PRD §13 texts, as owners see them:
  - kept: "Condensed milk closed at RM 146.00 a carton (105 cartons, 9 shops). RM 73.44 is back in your balance. Ready Tue 10 Nov."
  - dropped: "Grade B eggs closed at RM 12.33 all-in, above your limit of RM 12.20. Full refund: RM 123.30."
  - failed: "… didn't reach 10 cartons. Full refund: RM …. Next round closes Thu 12 Nov."
  - Ops: "Supplier order awaiting approval: condensed milk, RM 15,330.00."
- PRD §13: rounds that closed empty are not notified; round results go to owners only.
- PRD §7: "Skip to cut-off" sets the clock to the earliest open cut-off + 1 minute, then runs "close due rounds".
- PRD §21: event data holds ids, quantities, amounts and statuses only.

## Review Focus

1. **A shop with two participations in one round** (basket plus catalogue): each is refunded exactly, and the owner gets one combined message for that round. Pinned in Task 2.
2. **A round whose cut-off is exactly now:** it closes. One second earlier it doesn't. Pinned in Task 1.
3. **Two closes of the same round at once:** one outcome, one set of refunds. Pinned in Task 4.
4. **A shop's only door line for a date is dropped while another door line for the same date is kept:** the delivery fee stays. When every door line for that date is refunded, it comes back. Pinned in Task 1.
5. **"Skip to cut-off" with no open round left:** 409 `NO_OPEN_ROUND`, with the clock unchanged. Pinned in Task 5.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m05-round-close-and-outcomes`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names:
  - M1: `closeRound`, `explainOutcome`, `formatRM`, `formatUnits`.
  - M2: `post`, `appendLog`, `notify`, `TEMPLATES`, `emitEvent`, `createApproval`, `resolveClock`.
  - M3: `openNextRound`, `requiredDispatchDate`, `expectedReadyAt`.
  - M4: `cancelParticipation`'s delivery-fee refund code, `runDueJobs`, `setupKedaiKopi`, `payBasket`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Closing a round

**Files:**

- Create: `src/server/modules/rounds/close.ts`, `src/server/modules/payments/delivery-fees.ts`
- Modify:
  - `src/server/modules/payments/cancel.ts`: use the extracted helper.
  - `src/server/modules/jobs/run.ts`: run `closeDueRounds` before `expireBaskets`, and add `closedRounds` to the report.
- Test: `tests/api/round-close.test.ts`

**Interfaces:**

- Produces:
  - `refundDeliveryFeeIfUnused(ctx: TxContext, shopId: string, deliveryDate: string): Promise<number>`. It returns the refunded sen (0 or the fee).
    - It refunds only when the charge is `held` and no participation of that shop with `destinationType = 'door'` and that `deliveryDate` is in a status still heading for delivery: `active`, `kept`, `allocated`, `received`, `closed`.
    - The posting is `delivery_fee_hold → shop_balance` (`refund_delivery_fee`), and the charge becomes `refunded`.
    - It logs `refund.issued` and emits `refund.issued { kind: 'delivery_fee' }`.
  - `closeRoundById(deps: AppDeps, roundId: string): Promise<{ outcome: 'empty' | 'failed' | 'formed' | 'skipped' }>`. In one transaction:
    1. Lock the round with `FOR UPDATE`. Skip unless `status = 'open'` and `cutoffAt ≤ now`.
    2. Run the engine `closeRound` on the active participations.
    3. Update each participation: status `kept`, `dropped_price_limit` or `refunded_failed`; the final amounts; `outcomeReason`.
    4. Post the refunds: `refund_difference`, `refund_dropped` or `refund_failed`.
    5. Call `refundDeliveryFeeIfUnused` for each affected (shop, date) with door delivery.
    6. Update the round: status, `finalTier`, `finalUnitPriceSen`, `totalAtCutoff`, `totalKept`, `closeIterations`, `closedAt`.
    7. Logs: `round.closed`, `participation.dropped_price_limit`, `refund.issued`.
    8. Events: `round.closed { roundId, outcome, finalTier, finalUnitPriceSen, totalKept, shopCount }`, `participation.dropped`, `refund.issued { shopId, amountSen, kind: 'difference' | 'full', referenceId }`.
    9. `draftSupplierOrder` when formed (Task 3).
    10. `openNextRound(productId, opensAt = cutoffAt)` when the product is active.
    11. Notifications (Task 2).
  - `closeDueRounds(deps): Promise<{ closed: number }>`, ordered by `cutoffAt`, then id.

- [ ] **Step 1: Write the failing tests** (`seed: 'demo'`, Kedai Kopi set up and paid, clock at `2026-11-05T12:00:00Z`):

```ts
it('closes condensed milk at tier 3 and refunds RM 73.44 to Kedai Kopi Contoh (story 62)', async () => {
  await closeDueRounds(app.deps);
  expect(await app.prisma.round.findUniqueOrThrow({ where: { id: cmRound } })).toMatchObject({
    status: 'formed',
    finalTier: 3,
    finalUnitPriceSen: 14600,
    totalAtCutoff: 105,
    totalKept: 105,
  });
  expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({
    status: 'kept',
    finalAllInSen: 15185,
  });
  expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(
    7344 + otherKedaiRefunds(),
  );
});
it('drops Kafe Contoh’s Grade B eggs for its limit and refunds RM 123.30 (story 64)', async () => {
  await closeDueRounds(app.deps);
  expect(await participationOf('KAFE', 'EGG_B')).toMatchObject({
    status: 'dropped_price_limit',
    outcomeReason:
      'Dropped: the final all-in price of RM 12.33 is above your limit of RM 12.20. Full refund: RM 123.30.',
  });
});
it('fails tea dust below its minimum and refunds everyone in full (story 63)', async () => {
  /* TEA → status 'failed'; every participation 'refunded_failed'; hold 0 */
});
it('closes paper bags empty and opens the next round (story 94)', async () => {
  await closeDueRounds(app.deps);
  expect((await roundOf('KRAFT', '2026-W45')).status).toBe('empty');
  expect(await openRoundOf('KRAFT')).toMatchObject({ cutoffAt: new Date('2026-11-19T12:00:00Z') }); // fortnightly → W47
});
it('opens the next weekly round at the cut-off', async () => {
  expect((await openRoundOf('CM')).cutoffAt).toEqual(new Date('2026-11-12T12:00:00Z'));
});
it('closes a round exactly at its cut-off but not a second before', async () => {
  app.clock.set('2026-11-05T11:59:59Z');
  expect(await closeDueRounds(app.deps)).toEqual({ closed: 0 });
  app.clock.set('2026-11-05T12:00:00Z');
  expect((await closeDueRounds(app.deps)).closed).toBe(12);
});
it('keeps the delivery fee while another door line for that date is kept', async () => {
  /* Gerai: CM kept, a dropped door line for the same date → fee still held */
});
it('refunds the delivery fee when every door line for that date is refunded (story 68)', async () => {
  /* Gerai with only door lines in rounds that fail → fee refunded 1200 */
});
it('holds zero money for empty and failed rounds and passes every money check', async () => {
  await closeDueRounds(app.deps);
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(rounds): close due rounds with refunds and the next round`

---

### Task 2: Telling owners the result

**Files:**

- Modify: `src/server/modules/notifications/templates.ts` (`round.kept`, `round.dropped`, `round.failed`), `src/server/modules/rounds/close.ts`
- Test: `tests/api/round-close-notices.test.ts`

**Interfaces:**

- Produces one owner notification per (shop, round), never for background shops or staff:
  - **kept:** `{ShortName} closed at {formatRM(finalUnitPriceSen)} a {unit} ({formatUnits(totalKept, unit)}, {shopCount} shops). {formatRM(refund)} is back in your balance. Ready {formatMytDate(expectedReadyAt)}.` The refund sentence is left out when the refund is 0.
  - **dropped:** `{ShortName} closed at {formatRM(allIn at the dropping tier)} all-in, above your limit of {formatRM(limit)}. Full refund: {formatRM(refund)}.`
  - **failed:** `{ShortName} didn't reach {formatUnits(tier 1 minimum, unit)}. Full refund: {formatRM(refund)}. Next round closes {formatMytShortDate(next cut-off)}.` Here `formatMytShortDate` gives `"Thu 12 Nov"`; add it to `src/lib/format.ts`.
  - **A shop with two participations in one round:** the quantities and refunds are summed. When the outcomes differ, use one message per outcome.
  - Link: `/owner/kongsi`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('tells Kedai Kopi Contoh its condensed milk result (story 66)', async () => {
  expect(await lastWhatsapp('ahSeng', 'round.kept', 'condensed milk')).toBe(
    'Condensed milk closed at RM 146.00 a carton (105 cartons, 9 shops). RM 73.44 is back in your balance. Ready Tue 10 Nov.',
  );
});
it('tells Kafe Contoh its eggs were dropped', async () => {
  expect(await lastWhatsapp('mei', 'round.dropped')).toBe(
    'Grade B eggs closed at RM 12.33 all-in, above your limit of RM 12.20. Full refund: RM 123.30.',
  );
});
it('tells an owner when a round fails, with the next closing date', async () => {
  // Kedai Kopi also joins TEA 2 at Ipoh (paid 2 × 17498) → TEA total 8 → fails
  expect(await lastWhatsapp('ahSeng', 'round.failed')).toBe(
    "Tea dust didn't reach 10 cartons. Full refund: RM 349.96. Next round closes Thu 12 Nov.",
  );
});
it('combines two participations in one round into one message', async () => {
  // Kedai Kopi joins CM 2 more from the catalogue before cut-off → one round.kept message with "RM 97.92 is back" (8 × 12.24)
});
it('sends nothing to staff and nothing for empty rounds', async () => {
  /* no round.* notifications for rahim; none mention paper bags */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(rounds): notify owners of round results`

---

### Task 3: Drafting the supplier order for Ops

**Files:**

- Create: `src/server/modules/supplier-orders/draft.ts`
- Modify: `src/server/modules/rounds/close.ts`, `src/server/modules/notifications/templates.ts` (`ops.approval_needed`)
- Test: `tests/api/supplier-order-draft.test.ts`

**Interfaces:**

- Produces: `draftSupplierOrder(ctx, round, result: CloseRoundResult): Promise<{ supplierOrderId: string; approvalId: string }>`:
  - **The order:** quantity and accepted quantity = `totalKept`; `unitPriceSen = finalUnitPriceSen`; `totalSen = quantity × unit`; status `awaiting_ops`; `requiredDispatchDate = requiredDispatchDate(cutoffAt)`.
  - **The approval:** type `supplier_order`, assignee `ops`, amount `totalSen`.
    - summary `Supplier order: {units} of {shortName}, {RM total}`; `whyNeeded` `Pooled money is committed only after an Ops approval.`
    - evidence `{ productName, supplierName, finalTier, quantity, shopCount, moneyHeldSen, orderCostSen, feesSen, shippingSen, moneyCheck: { passed: boolean; detail: string }, roundLink: '/ops/rounds/<id>' }`
    - The check passes when `moneyHeldSen === orderCostSen + feesSen + shippingSen`, where fees and shipping are summed over kept participations.
  - It logs `supplier_order.drafted` (system) and notifies Ops: `Supplier order awaiting approval: {shortName}, {RM total}.`

- [ ] **Step 1: Write the failing tests:**

```ts
it('drafts the condensed milk order for 105 cartons at RM 15,330.00', async () => {
  const so = await supplierOrderOf(cmRound);
  expect(so).toMatchObject({
    quantity: 105,
    acceptedQuantity: 105,
    unitPriceSen: 14600,
    totalSen: 1533000,
    status: 'awaiting_ops',
    requiredDispatchDate: '2026-11-07',
  });
});
it('puts the evidence and a passing money check in front of Ops (story 118)', async () => {
  const a = await approvalFor(so.id);
  expect(a.evidence).toMatchObject({
    finalTier: 3,
    quantity: 105,
    shopCount: 9,
    orderCostSen: 1533000,
    moneyCheck: { passed: true },
  });
  expect(a.evidence.moneyHeldSen).toBe(
    a.evidence.orderCostSen + a.evidence.feesSen + a.evidence.shippingSen,
  );
});
it('tells Ops an order is waiting', async () => {
  expect(await lastWhatsapp('nadia', 'ops.approval_needed', 'condensed milk')).toBe(
    'Supplier order awaiting approval: condensed milk, RM 15,330.00.',
  );
});
it('drafts nothing for empty or failed rounds', async () => {
  /* KRAFT and TEA have no supplier order */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(supplier-orders): draft the consolidated order and its Ops approval`

---

### Task 4: Safe to run twice, safe to run at once

**Files:**

- Test: `tests/api/round-close-idempotency.test.ts`

- [ ] **Step 1: Write the tests:**

```ts
it('changes nothing when the close job runs twice (story 177)', async () => {
  await closeDueRounds(app.deps);
  const postings = await app.prisma.ledgerPosting.count();
  expect(await closeDueRounds(app.deps)).toEqual({ closed: 0 });
  expect(await app.prisma.ledgerPosting.count()).toBe(postings);
});
it('closes once when two workers close the same round together', async () => {
  const other = { ...app.deps, prisma: createPrismaClient(app.appUrl) };
  const results = await Promise.all([
    closeRoundById(app.deps, cmRound),
    closeRoundById(other, cmRound),
  ]);
  expect(results.map((r) => r.outcome).sort()).toEqual(['formed', 'skipped']);
  expect(
    await app.prisma.activityLogEntry.count({
      where: { action: 'round.closed', subjectId: cmRound },
    }),
  ).toBe(1);
  expect(await app.prisma.supplierOrder.count({ where: { roundId: cmRound } })).toBe(1);
});
```

- [ ] **Step 2:** Run. Expected: PASS if Task 1 locks correctly. If it fails, fix the locking in `close.ts` (lock before reading the status).
- [ ] **Step 3: Commit:** `test(rounds): prove closing is idempotent and concurrency-safe`

---

### Task 5: "Skip to cut-off" and the My Kongsi list

**Files:**

- Create: `src/app/api/demo/skip-to-cutoff/route.ts`, `src/server/modules/payments/participations.ts`, `src/app/api/shops/[shopId]/participations/route.ts`, `src/lib/views/participations.ts`
- Modify: `src/server/modules/demo/demo.ts`
- Test: `tests/api/skip-and-my-kongsi.test.ts`

**Interfaces:**

- Produces:
  - `skipToCutoff(deps, caller): Promise<DemoState & { closed: number }>`. Demo mode only (404 `DEMO_OFF`).
    - It sets `clock_offset_ms` so that now = the earliest open cut-off + 1 minute, then runs `closeDueRounds` and `expireBaskets`.
    - It logs `demo.skip_to_cutoff`.
    - With no open round it returns 409 `NO_OPEN_ROUND`.
  - `listShopParticipations(deps, caller, shopId, filter: { status: 'active' | 'history'; cursor; limit }): Promise<{ items: ParticipationView[]; nextCursor }>` (owner).
    - `ParticipationView = { participationId; roundId; productId; productName; shortName; unitName; imageUrl; quantity; status; cutoffAt; expectedReadyAt; startingAllInSen; finalAllInSen: number | null; paidSen; refundSen; outcomeReason: string | null }`.
    - `refundSen` = the sum of refund postings for the participation. M7 and M9 add the delivery result and savings.

- [ ] **Step 1: Write the failing tests:**

```ts
it('moves the clock to the first cut-off and closes the rounds (story 164)', async () => {
  const s = (await (await app.as('nadia')).post('/api/demo/skip-to-cutoff')).body;
  expect(s.now).toBe('2026-11-05T12:01:00.000Z');
  expect(s.closed).toBe(12);
});
it('says when there is no open round to skip to', async () => {
  /* close every round and deactivate products → 409 NO_OPEN_ROUND; offset unchanged */
});
it("lists the owner's results with refunds (story 67)", async () => {
  const items = (await ah.get(`/api/shops/${KEDAI}/participations?status=history`)).body.items;
  expect(items.find((i: any) => i.shortName === 'condensed milk')).toMatchObject({
    status: 'kept',
    paidSen: 98454,
    finalAllInSen: 15185,
    refundSen: 7344,
  });
});
it('needs demo mode for skipping', async () => {
  /* demo off → 404 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(demo): skip to cut-off; list my Kongsi results`

---

### Task 6: The integration events page's API

**Files:**

- Create: `src/app/api/ops/events/route.ts`
- Test: `tests/api/ops-events.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
it('lets only Ops see the latest 100 events (story 132)', async () => {
  expect((await (await app.as('ahSeng')).get('/api/ops/events')).status).toBe(403);
  const ev = (await (await app.as('nadia')).get('/api/ops/events')).body.items;
  expect(ev.length).toBeLessThanOrEqual(100);
  expect(ev.map((e: any) => e.type)).toEqual(
    expect.arrayContaining(['round.closed', 'refund.issued', 'participation.dropped']),
  );
});
it('never carries a business or person name in event data (PRD §21)', async () => {
  const s = JSON.stringify((await (await app.as('nadia')).get('/api/ops/events')).body);
  expect(s).not.toMatch(/Contoh|Ah Seng|Siti|Mei/);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement with `listEvents` (M2), newest first. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(api): add the Ops integration events feed`

---

### Task 7: Screens for outcomes, skipping and events

**Files:**

- Create: `src/app/(shell)/ops/events/page.tsx`, `src/components/kongsi/participation-card.tsx`
- Modify: `src/app/(shell)/owner/kongsi/page.tsx` (active and history), `src/app/(shell)/owner/rounds/[roundId]/page.tsx` (closed state), `src/components/rounds/round-card.tsx` ("Closing…" past cut-off, R11), `src/components/shell/demo-menu.tsx` ("Skip to cut-off", with a confirmation)

- [ ] **Step 1: Build the outcome screens.**
  - **My Kongsi:** "Active" and "History" tabs. Each card shows its outcome sentence (`outcomeReason`), the money paid, the refund and the expected ready date.
  - **Closed round detail:** "Closed at RM 146.00 a carton (tier 3): 105 cartons from 9 shops."
  - **A missed round:** "Next round closes Thu 12 Nov" (story 50).
- [ ] **Step 2: Build the Ops events page.** A table of type, time (MYT) and data (pretty-printed JSON), with "Latest 100" and an explanation of how other Orbyte apps would subscribe (P1 webhooks).
- [ ] **Step 3: Verify** with Chrome DevTools after `pnpm db:reset`:
  1. Ah Seng sets up and pays.
  2. Use Demo → Skip to cut-off. Expected: a notification "RM 73.44 is back in your balance". My Kongsi shows the condensed milk result.
  3. Switch to Mei. Expected: the Grade B eggs dropout and RM 123.30.
  4. Switch to Nadia. Expected: the events page lists the close events.
- [ ] **Step 4:** Run `pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ui): show round results, skip to cut-off and the events page`

---

### Milestone verification

- [ ] Run `pnpm verify`, then `pnpm db:reset` and the Task 7 walkthrough.
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 59, 61–64, 66, 68, 94, 132, 160, 164, 177).
