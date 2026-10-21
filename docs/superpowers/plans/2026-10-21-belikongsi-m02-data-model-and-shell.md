# M2 Data Model and Orbyte Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete P0 schema with its security objects, and the platform services every later milestone writes through: transactions, the hash-chained activity log, the double-entry ledger, notifications, approvals and integration events. Also the deterministic seed of reference data, simulated sign-in, demo reset and the simulated Orbyte shell.

**Architecture:**

- Prisma models map PRD §4 one to one; the raw SQL in the migration adds what Prisma can't express.
- Every state change goes through `withTransaction`. Its `TxContext` carries the resolved clock, the caller and the transaction client. `appendLog`, `post`, `notify`, `createApproval` and `emitEvent` all take that context, so they commit or roll back together (R3).
- Nested `withTransaction` calls join the outer transaction through `AsyncLocalStorage`, which lets "Reset demo data" run the whole seed in one transaction.

**Tech Stack:** Prisma 7.10.1, PostgreSQL 17, Next.js 16 route handlers and server components, Zod 4, shadcn/ui, node:crypto (SHA-256, HMAC, UUID v5).

**Spec:** PRD §4, §12, §13, §14, §15, §19, §20 (session, notifications, approvals, activity, demo), §22 (shared screens), §23; build design R1–R11, §5.2, C6, D8; index §4 and §5.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §14 hash: `hash = SHA-256(previous hash + canonical JSON of the entry's fields with sorted keys)`; the first entry's previous hash is 64 zeros; writers lock the chain head in the same transaction.
- PRD §15 visibility. Activity log: owner sees their shop; staff see their own entries with amounts redacted; supplier sees entries about their supplier orders; Ops sees everything.
- PRD §13 channels: WhatsApp preview text at most 300 characters; the share link has no phone number (`https://wa.me/?text=…`); staff text never contains amounts, prices or balances.
- PRD §19 identity: session cookie HTTP-only, `Secure` in production, `SameSite=Lax`, signed; no passwords.
- Ledger accounts: shop balance, round hold, delivery fee hold, supplier payable, fee revenue, logistics payable, claims expense, partner cash (PRD §4). Shop balance, round hold and delivery fee hold never go negative (PRD §6.11).
- The "Made-up data" banner stays visible in demo mode (PRD §19).

## Review Focus

1. **Two requests append to the log at the same instant:** sequence numbers stay consecutive and the chain stays valid, because writers lock the chain head. Pinned in Task 4.
2. **A tampered cookie** (edited user id or membership id): the request gets 401, never another person's session. Pinned in Task 8.
3. **A user switching to a membership that isn't theirs** outside demo mode: 404, not a switch. Pinned in Task 8.
4. **An append-only row changed through a privileged connection:** "Verify log" reports the first broken sequence number instead of "valid". Pinned in Task 4.
5. **Reset clicked twice quickly:** the second reset waits for the first and both end in the same seeded state with a valid chain. Never a half-seeded database. Pinned in Task 10.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m02-data-model-and-shell`
- [ ] **Step 2:** Follow index §6. Confirm in M0 code: `route`, `json`, `AppDeps`, `getDeps`, `setDepsForTests`, `createTestDatabase`, `callRoute`, `bk_secure_all_tables()`; confirm in M1 code: `formatRM`, `formatUnits`, `validateTiers`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Schema, migration and database security tests

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_p0_schema/migration.sql` (generated, then extended by hand)
- Test: `tests/api/schema-security.test.ts`

**Interfaces:**

- Produces: the Prisma models and enums below. Table names are the snake_case plural (`@@map`); columns are snake_case (`@map`); ids are `String @id @default(uuid()) @db.Uuid` unless shown; times are `DateTime @db.Timestamptz`; date-only values are `String` (`YYYY-MM-DD`, MYT); money is `Int` (sen) except running balances (`BigInt`).

**Enums:**

- `ShopType` kopitiam | hawker | cafe | restaurant | bakery
- `Fulfilment` pickup | door
- `OrgType` shop | supplier | operator
- `Role` owner | staff | supplier | ops
- `SignInProvider` microsoft | google
- `SupplierStatus` active | paused
- `ProductCategory` dairy | oil | flour | beverages | eggs | packaging
- `UnitName` carton | tin | tray | sack | pack
- `Cadence` weekly | fortnightly | monthly
- `RoundStatus` scheduled | open | empty | failed | formed | ordered | confirmed | dispatched | at_hub | completed | cancelled
- `BasketStatus` draft | payment_pending | paid | skipped | expired
- `LineSource` usual_list | staff | owner
- `ParticipationSource` weekly_basket | catalogue | background_seed
- `ParticipationStatus` active | cancelled | dropped_price_limit | refunded_failed | kept | refunded_round_cancelled | allocated | shorted | received | closed
- `BaselineKind` usual | buy_alone
- `PaymentPurpose` basket | join
- `PaymentMethod` duitnow_qr | fpx | balance_only
- `PaymentStatus` pending | succeeded | failed | voided
- `DeliveryFeeStatus` held | passed_to_partner | refunded
- `AccountKind` shop_balance | round_hold | delivery_fee_hold | supplier_payable | fee_revenue | logistics_payable | claims_expense | partner_cash
- `PostingKind` payment_in | balance_applied | delivery_fee_in | refund_cancelled | refund_difference | refund_dropped | refund_failed | refund_round_cancelled | refund_shortfall | refund_delivery_fee | settlement_supplier | settlement_fee | settlement_logistics | supplier_payout | delivery_fee_to_partner | refund_claim
- `SupplierOrderStatus` awaiting_ops | awaiting_supplier | confirmed | dispatched | settled | rejected_by_ops | rejected_by_supplier
- `DestinationType` pickup_point | door
- `ConsignmentStatus` planned | dispatched | arrived | out_for_delivery | delivered | completed
- `PickupStatus` waiting | ready | out_for_delivery | collected | delivered | checked | closed
- `CheckResult` all_received | issues
- `ClaimStatus` submitted | approved | rejected
- `ApprovalType` weekly_basket | supplier_order | supplier_confirmation | claim
- `ApprovalStatus` pending | approved | rejected | expired
- `ActorType` person | system | ai
- `AiRunKind` usual_list_text
- `AiRunStatus` succeeded | failed | saved_example

**Models**, as `Model (table)`: fields (`?` = optional):

| Model (table)                                | Fields                                                                                                                                                                                                                                                                                                                                                                      | Constraints                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Operator` (`operators`)                     | id, name                                                                                                                                                                                                                                                                                                                                                                    |                                                                                                                |
| `Hub` (`hubs`)                               | id, name, region, address, lat Float, lng Float                                                                                                                                                                                                                                                                                                                             |                                                                                                                |
| `PickupPoint` (`pickup_points`)              | id, name, address, state, lat Float, lng Float, openingHours, active Boolean                                                                                                                                                                                                                                                                                                |                                                                                                                |
| `Shop` (`shops`)                             | id, name, type ShopType, address, state, postcode, lat Float, lng Float, defaultFulfilment Fulfilment, defaultPickupPointId? → PickupPoint, isBackground Boolean, setupCompletedAt?, createdAt                                                                                                                                                                              |                                                                                                                |
| `Supplier` (`suppliers`)                     | id, name, categories ProductCategory[], region, hubId → Hub, contactName, contactPhone, status SupplierStatus                                                                                                                                                                                                                                                               |                                                                                                                |
| `User` (`users`)                             | id, displayName, email?, phone?, signInProvider SignInProvider?, createdAt                                                                                                                                                                                                                                                                                                  |                                                                                                                |
| `Membership` (`memberships`)                 | id, userId → User, orgType OrgType, shopId?, supplierId?, operatorId?, role Role, endedAt?                                                                                                                                                                                                                                                                                  | index (userId)                                                                                                 |
| `Product` (`products`)                       | id, supplierId → Supplier, name, shortName, category, packDescription, unitName UnitName, unitWeightGrams Int, buyAlonePriceSen Int, aliases String[], packConversions Json, imageKey?, imageAiGenerated Boolean, cadence Cadence, scheduleAnchorWeek String, cutoffWeekday Int (ISO 1–7, default 4), cutoffTime String (default "20:00"), active Boolean                   |                                                                                                                |
| `PriceTier` (`price_tiers`)                  | id, productId → Product, position Int, minQuantity Int, unitPriceSen Int                                                                                                                                                                                                                                                                                                    | unique (productId, position)                                                                                   |
| `Round` (`rounds`)                           | id, productId, supplierId, hubId, cycleLabel, opensAt, cutoffAt, expectedReadyAt, tiersSnapshot Json, feeBps Int, buyAlonePriceSen Int, unitWeightGrams Int, status RoundStatus, finalTier Int?, finalUnitPriceSen Int?, totalAtCutoff Int?, totalKept Int?, closeIterations Int?, closedAt?                                                                                | partial unique (product_id) WHERE status = 'open'                                                              |
| `UsualList` (`usual_lists`)                  | id, shopId (unique), confirmedAt, updatedAt                                                                                                                                                                                                                                                                                                                                 |                                                                                                                |
| `UsualListItem` (`usual_list_items`)         | id, usualListId, productId, quantity Int, usualPriceSen Int?, priceLimitSen Int?                                                                                                                                                                                                                                                                                            | unique (usualListId, productId)                                                                                |
| `WeeklyBasket` (`weekly_baskets`)            | id, shopId, basketWeek, status BasketStatus, deadlineAt, fulfilment Fulfilment, pickupPointId?, approvedAt?, approvedByUserId?, skipReason?, firstOpenedAt?, approvalRequestId?, createdAt                                                                                                                                                                                  | unique (shopId, basketWeek)                                                                                    |
| `BasketLine` (`basket_lines`)                | id, basketId, productId, roundId, quantity Int, priceLimitSen Int?, source LineSource, changedByUserId?, changedByRole Role?, staffAddedQuantity Int (default 0), removed Boolean, notice?                                                                                                                                                                                  | unique (basketId, productId)                                                                                   |
| `Payment` (`payments`)                       | id, shopId, purpose PaymentPurpose, basketId?, linesTotalSen Int, deliveryFeeSen Int, totalSen Int, balanceAppliedSen Int, externalSen Int, method PaymentMethod?, status PaymentStatus, partnerReference?, deadlineAt, createdByUserId?, createdAt, completedAt?                                                                                                           |                                                                                                                |
| `PaymentLine` (`payment_lines`)              | id, paymentId, productId, roundId, basketLineId?, quantity Int, priceLimitSen Int?, fulfilment, destinationType DestinationType, pickupPointId, deliveryDate, unitGoodsSen, unitFeeSen, unitShippingSen, unitAllInSen, lineSen, baselineSen, baselineKind BaselineKind                                                                                                      |                                                                                                                |
| `Participation` (`participations`)           | id, roundId, shopId, paymentId, paymentLineId (unique), basketLineId?, quantity, priceLimitSen?, fulfilment, destinationType, pickupPointId, deliveryDate, joinedAt, source ParticipationSource, unitShippingSen, baselineSen, baselineKind, startingAllInSen, paidSen, finalGoodsSen?, finalFeeSen?, finalAllInSen?, status ParticipationStatus, outcomeReason?, updatedAt | index (roundId, status)                                                                                        |
| `DeliveryFeeCharge` (`delivery_fee_charges`) | id, shopId, deliveryDate, amountSen, paymentId, status DeliveryFeeStatus                                                                                                                                                                                                                                                                                                    | unique (shopId, deliveryDate)                                                                                  |
| `LedgerAccount` (`ledger_accounts`)          | id, key (unique), kind AccountKind, shopId?, roundId?, supplierId?, deliveryDate?, balanceSen BigInt default 0                                                                                                                                                                                                                                                              | CHECK (kind NOT IN ('shop_balance','round_hold','delivery_fee_hold') OR balance_sen >= 0)                      |
| `LedgerPosting` (`ledger_postings`)          | id, seq BigInt autoincrement (unique), occurredAt, fromAccountId, toAccountId, amountSen Int, kind PostingKind, roundId?, participationId?, paymentId?, claimId?, supplierOrderId?, shopId?, supplierId?, memo?                                                                                                                                                             | CHECK (amount_sen > 0); append-only                                                                            |
| `SupplierOrder` (`supplier_orders`)          | id, roundId (unique), supplierId, hubId, quantity, acceptedQuantity, unitPriceSen, totalSen, status SupplierOrderStatus, opsApprovalId?, supplierApprovalId?, requiredDispatchDate, expectedDispatchDate?, confirmedAt?, dispatchedAt?, rejectionReason?, createdAt                                                                                                         |                                                                                                                |
| `HubCheck` (`hub_checks`)                    | id, supplierOrderId (unique), goodUnits, damagedUnits, notes?, checkedByUserId?, checkedAt, receivedCounted, shortfallUnits, excessUnits, payoutSen, payoutReference                                                                                                                                                                                                        |                                                                                                                |
| `Allocation` (`allocations`)                 | id, participationId (unique), allocated, missing, consignmentId?, pickupId?, createdAt                                                                                                                                                                                                                                                                                      |                                                                                                                |
| `Consignment` (`consignments`)               | id, hubId, destinationType, pickupPointId?, shopId?, destinationKey, deliveryDate, wave Int, status ConsignmentStatus, statusHistory Json, partnerReference, createdAt                                                                                                                                                                                                      | unique (hubId, destinationKey, deliveryDate, wave)                                                             |
| `Pickup` (`pickups`)                         | id, shopId, destinationType, pickupPointId?, destinationKey, deliveryDate, code, status PickupStatus, readyAt?, collectedAt?, collectedByUserId?, createdAt                                                                                                                                                                                                                 | unique (shopId, destinationKey, deliveryDate); partial unique (destination_key, code) WHERE status <> 'closed' |
| `DeliveryCheck` (`delivery_checks`)          | id, pickupId (unique), submittedByUserId, submittedAt, result CheckResult                                                                                                                                                                                                                                                                                                   |                                                                                                                |
| `DeliveryCheckLine` (`delivery_check_lines`) | id, deliveryCheckId, allocationId, expected, receivedGood, missing, damaged                                                                                                                                                                                                                                                                                                 |                                                                                                                |
| `Photo` (`photos`)                           | id, pickupId, deliveryCheckLineId?, storageKey, contentType, sizeBytes, uploadedByUserId, uploadedAt, deleteAfter, deletedAt?                                                                                                                                                                                                                                               |                                                                                                                |
| `Claim` (`claims`)                           | id, deliveryCheckId (unique), shopId, totalRefundSen, status ClaimStatus, approvalRequestId?, decidedByUserId?, decidedAt?, reason?, createdAt                                                                                                                                                                                                                              |                                                                                                                |
| `ClaimLine` (`claim_lines`)                  | id, claimId, allocationId, missing, damaged, refundSen                                                                                                                                                                                                                                                                                                                      |                                                                                                                |
| `ApprovalRequest` (`approval_requests`)      | id, type ApprovalType, subjectType, subjectId, shopId?, supplierId?, assigneeRole Role, amountSen?, summary, whyNeeded, evidence Json, proposedByType ActorType, proposedByUserId?, status ApprovalStatus, decidedByUserId?, decidedAt?, reason?, expiresAt?, createdAt                                                                                                     | index (status, assigneeRole)                                                                                   |
| `Notification` (`notifications`)             | id, userId, role Role, shopId?, supplierId?, type, title, body, link, whatsappText, dedupeKey? (unique), createdAt, readAt?                                                                                                                                                                                                                                                 | index (userId, createdAt)                                                                                      |
| `ActivityLogEntry` (`activity_log_entries`)  | seq BigInt @id, occurredAt, actorUserId?, actorRole Role?, actorType ActorType, shopId?, supplierId?, operatorScope Boolean, action, subjectType, subjectId, before Json?, after Json?, reason?, aiMetadata Json?, prevHash, hash                                                                                                                                           | append-only; index (shopId), (supplierId), (actorUserId), (subjectType, subjectId)                             |
| `ActivityChainHead` (`activity_chain_head`)  | id Int @id default 1, lastSeq BigInt, lastHash                                                                                                                                                                                                                                                                                                                              | one row, inserted by the migration with (0, 64 zeros)                                                          |
| `AiSuggestionRun` (`ai_suggestion_runs`)     | id, shopId, kind AiRunKind, redactedInput, model, status AiRunStatus, suggestions Json, latencyMs Int, createdAt, confirmedAt?, changeSummary Json?                                                                                                                                                                                                                         |                                                                                                                |
| `IntegrationEvent` (`integration_events`)    | id, seq BigInt autoincrement (unique), type, version Int, occurredAt, data Json                                                                                                                                                                                                                                                                                             |                                                                                                                |
| `DemoSettings` (`demo_settings`)             | id Int @id default 1, demoMode Boolean, clockOffsetMs BigInt, seedVersion, lastResetAt?, featuredProductId?                                                                                                                                                                                                                                                                 | one row, inserted by the migration (demo mode on, offset 0)                                                    |
| `IdempotencyRecord` (`idempotency_records`)  | scope, key, status Int, body Json, createdAt                                                                                                                                                                                                                                                                                                                                | primary key (scope, key)                                                                                       |
| `RateLimitHit` (`rate_limit_hits`)           | id, bucket, at                                                                                                                                                                                                                                                                                                                                                              | index (bucket, at)                                                                                             |

**Hand-written SQL appended to the migration** (after Prisma's DDL):

- The partial unique indexes and CHECK constraints from the table above.
- `bk_reject_change()` trigger function (`RAISE EXCEPTION '% is append-only', TG_TABLE_NAME`) with `BEFORE UPDATE OR DELETE` row triggers on `activity_log_entries` and `ledger_postings`.
- Seed rows for `activity_chain_head` and `demo_settings`.
- Column privileges on `demo_settings`, after `bk_secure_all_tables()`:
  - `REVOKE UPDATE ON demo_settings FROM bk_app`
  - `GRANT UPDATE (clock_offset_ms, seed_version, last_reset_at, featured_product_id) ON demo_settings TO bk_app`
- `bk_demo_reset()`: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`.
  - It raises `'demo mode is off'` unless `demo_settings.demo_mode`.
  - It then truncates every `public` table except `_prisma_migrations`, `demo_settings` and `activity_chain_head`, in one dynamic `TRUNCATE … RESTART IDENTITY CASCADE`.
  - It resets the chain head to (0, 64 zeros).
  - Followed by `REVOKE ALL ON FUNCTION bk_demo_reset() FROM PUBLIC; GRANT EXECUTE ON FUNCTION bk_demo_reset() TO bk_app;`.
- The final line: `SELECT bk_secure_all_tables();` (then the `demo_settings` column grants).

- [ ] **Step 1: Write the failing tests.** Each test uses a fresh `createTestDatabase()`. `admin` is the superuser connection; `app` is the `bk_app` connection.

```ts
it('enables row-level security with the app policy on every table', async () => {
  const rows = await query(
    admin,
    `select c.relname, c.relrowsecurity, exists(select 1 from pg_policies p where p.tablename = c.relname and p.policyname = 'bk_app_all') as has_policy
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '_prisma_migrations'`,
  );
  expect(rows.length).toBeGreaterThan(35);
  expect(rows.filter((r) => !r.relrowsecurity || !r.has_policy)).toEqual([]);
});
it('lets anon and authenticated read nothing', async () => {
  /* for each table: set role anon / authenticated; select → /permission denied/ */
});
it('keeps log entries and postings append-only for the app role', async () => {
  /* as app: update/delete activity_log_entries & ledger_postings → /permission denied/ */
});
it('stops even the owner changing log entries', async () => {
  await exec(
    admin,
    `insert into activity_log_entries (seq, occurred_at, actor_type, operator_scope, action, subject_type, subject_id, prev_hash, hash) values (1, now(), 'system', true, 'x', 'x', 'x', repeat('0',64), repeat('a',64))`,
  );
  await expect(
    exec(admin, 'update activity_log_entries set action = $$y$$ where seq = 1'),
  ).rejects.toThrow(/append-only/);
});
it('allows only one open round per product', async () => {
  /* insert supplier, hub, product, then two rounds status 'open' → unique violation */
});
it('refuses a negative shop balance', async () => {
  await expect(
    exec(
      app,
      `insert into ledger_accounts (id, key, kind, balance_sen) values (gen_random_uuid(), 'shop_balance:x', 'shop_balance', -1)`,
    ),
  ).rejects.toThrow(/check constraint/);
});
it('lets the app role move the demo clock but not switch demo mode off', async () => {
  await exec(app, 'update demo_settings set clock_offset_ms = 5 where id = 1');
  await expect(
    exec(app, 'update demo_settings set demo_mode = false where id = 1'),
  ).rejects.toThrow(/permission denied/);
});
it('resets demo data only while demo mode is on', async () => {
  await exec(app, 'select bk_demo_reset()');
  await exec(admin, 'update demo_settings set demo_mode = false');
  await expect(exec(app, 'select bk_demo_reset()')).rejects.toThrow(/demo mode is off/);
});
```

- [ ] **Step 2:** Run `pnpm test:api -- schema-security`. Expected: FAIL.
- [ ] **Step 3: Write the migration.** Edit `schema.prisma`, run `pnpm db:migrate --create-only --name p0_schema`, append the hand-written SQL, then run `pnpm db:migrate`.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(db): add the P0 schema with row-level security and append-only tables`

---

### Task 2: Clock, Malaysia time and formatters

**Files:**

- Create: `src/server/adapters/clock.ts`, `src/lib/time.ts`, `src/lib/format.ts`
- Test: `tests/unit/time-format.test.ts`

**Interfaces:**

- Produces:
  - `clock.ts`: `interface Clock { now(): Date }`, `interface MutableClock extends Clock { set(iso: string): void; advance(ms: number): void }`, `systemClock`, `fixedClock(iso: string): MutableClock`, `withOffset(base: Clock, offsetMs: number): Clock`.
  - `time.ts` (Malaysia time):
    - `mytParts(d: Date): { year; month; day; hour; minute; isoWeekday }`
    - `mytInstant(year, month, day, hour, minute): Date`
    - `isoWeekOf(d: Date): string` (`"2026-W45"`)
    - `isoWeekStart(week: string): Date` (Monday 00:00 MYT)
    - `addIsoWeeks(week: string, n: number): string`
    - `isoWeekIndex(week: string): number` (consecutive integers)
    - `mytDate(d: Date): string` (`"2026-11-10"`)
    - `mostRecentMonday0605(now: Date): Date`
  - `format.ts`: re-exports `formatRM`, `formatUnits` from the engine; `formatMyt(d)` (`"Thu 5 Nov, 8:00 pm"`), `formatMytShort(d)` (`"Thu 8 pm"`, or `"Thu 8:30 pm"`), `formatMytDate(dOrYmd)` (`"Tue 10 Nov"`), `formatPickupCode(code)` (`"482 913"`).

- [ ] **Step 1: Write the failing tests:**

```ts
it('names ISO weeks in Malaysia time', () => {
  expect(isoWeekOf(new Date('2026-11-01T22:05:00Z'))).toBe('2026-W45'); // Mon 2 Nov 06:05 MYT
  expect(isoWeekOf(new Date('2026-11-01T15:59:00Z'))).toBe('2026-W44'); // Sun 1 Nov 23:59 MYT
  expect(isoWeekOf(mytInstant(2027, 1, 1, 12, 0))).toBe('2026-W53');
  expect(isoWeekStart('2026-W45').toISOString()).toBe('2026-11-01T16:00:00.000Z');
  expect(isoWeekIndex(addIsoWeeks('2026-W53', 1)) - isoWeekIndex('2026-W53')).toBe(1);
});
it('formats Malaysia times the way the PRD shows them', () => {
  const cutoff = new Date('2026-11-05T12:00:00Z');
  expect(formatMyt(cutoff)).toBe('Thu 5 Nov, 8:00 pm');
  expect(formatMytShort(cutoff)).toBe('Thu 8 pm');
  expect(formatMyt(new Date('2026-11-05T16:30:00Z'))).toBe('Fri 6 Nov, 12:30 am');
  expect(formatMytDate('2026-11-10')).toBe('Tue 10 Nov');
  expect(formatPickupCode('482913')).toBe('482 913');
});
it('finds the most recent Monday 06:05 in Malaysia', () => {
  expect(mostRecentMonday0605(new Date('2026-11-04T03:00:00Z')).toISOString()).toBe(
    '2026-11-01T22:05:00.000Z',
  );
  expect(mostRecentMonday0605(new Date('2026-11-01T21:00:00Z')).toISOString()).toBe(
    '2026-10-25T22:05:00.000Z',
  );
});
it('offsets a clock', () =>
  expect(withOffset(fixedClock('2026-11-01T22:05:00Z'), 60_000).now().toISOString()).toBe(
    '2026-11-01T22:06:00.000Z',
  ));
```

- [ ] **Step 2:** Run. **Step 3:** Implement. Use arithmetic on UTC + 8 hours rather than `Intl` time zones, because Malaysia has no daylight saving time. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: add clock, Malaysia-time helpers and formatters`

---

### Task 3: Transactions, callers, idempotency, rate limits and pagination

**Files:**

- Create: `src/server/platform/caller.ts`, `src/server/platform/tx.ts`, `src/server/platform/idempotency.ts`, `src/server/platform/rate-limit.ts`, `src/server/platform/pagination.ts`, `tests/api/helpers/app.ts`
- Modify: `src/server/platform/deps.ts` (`AppDeps.clock: Clock`)
- Test: `tests/api/platform.test.ts`

**Interfaces:**

- Produces:
  - `type Actor = { type: 'person'; userId: string; role: Role; shopId?: string; supplierId?: string } | { type: 'system'; reason: string } | { type: 'ai'; model: string }`
  - `type Caller = { kind: 'person'; session: Session } | { kind: 'system'; reason: string }`; `personCaller(session)`; `systemCaller(reason)`; `actorOf(caller): Actor`.
    - `Session` is defined in Task 8. Use a forward type import, so this task only needs the `Session` type: `{ userId: string; displayName: string; membership: { id: string; role: Role; orgType: OrgType; shopId?: string; supplierId?: string; operatorId?: string } }`.
  - `resolveClock(deps: AppDeps): Promise<Clock>`: the base clock plus `demo_settings.clock_offset_ms`, or no offset when `demoMode` is false.
  - `interface TxContext { tx: Prisma.TransactionClient; now: Date; caller: Caller; actor: Actor; deps: AppDeps }`
  - `withTransaction<T>(deps: AppDeps, caller: Caller, fn: (ctx: TxContext) => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>`.
    - READ COMMITTED; default timeout 15,000 ms.
    - Retries 3 times on Postgres `40001`/`40P01` or Prisma `P2034`.
    - **Propagation:** an inner call joins the outer transaction (`AsyncLocalStorage`) and gets its own `caller`/`actor` but the same `tx` and `now`.
  - `withIdempotency(deps, scope: string, key: string | null, fn: () => Promise<{ status: number; body: unknown }>)`: replays the stored response for a repeated `(scope, key)`.
  - `enforceRateLimit(deps, bucket: string, limit: number, windowMs: number): Promise<void>`: throws `rateLimited()`.
  - `parsePage(params: URLSearchParams): { cursor: string | null; limit: number }` (default 20, clamped to 1–100); `toPage<T>(rows: T[], limit: number, cursorOf: (t: T) => string): { items: T[]; nextCursor: string | null }`, given `limit + 1` rows.
  - Test helper `createTestDeps(opts?: { now?: string }): Promise<{ deps: AppDeps; db: TestDatabase; clock: MutableClock; close(): Promise<void> }>` (clock default `2026-11-01T22:05:00Z`).

- [ ] **Step 1: Write the failing tests:**

```ts
it('reads the demo clock once per transaction', async () => {
  await exec(t.db.adminUrl, 'update demo_settings set clock_offset_ms = 3600000');
  const now = await withTransaction(t.deps, systemCaller('test'), async (ctx) =>
    ctx.now.toISOString(),
  );
  expect(now).toBe('2026-11-01T23:05:00.000Z');
});
it('joins an outer transaction and rolls back together', async () => {
  await expect(
    withTransaction(t.deps, sys, async (outer) => {
      await outer.tx.rateLimitHit.create({ data: { bucket: 'a', at: outer.now } });
      await withTransaction(t.deps, sys, async (inner) => {
        await inner.tx.rateLimitHit.create({ data: { bucket: 'b', at: inner.now } });
        throw new Error('boom');
      });
    }),
  ).rejects.toThrow('boom');
  expect(await t.deps.prisma.rateLimitHit.count()).toBe(0);
});
it('retries a serialization failure once and succeeds', async () => {
  /* fn throws { code: '40001' } on its first call → result returned; calls === 2 */
});
it('replays the first response for a repeated idempotency key', async () => {
  let n = 0;
  const run = () =>
    withIdempotency(t.deps, 'u1:POST:/x', 'k1', async () => ({ status: 200, body: { n: ++n } }));
  expect((await run()).body).toEqual({ n: 1 });
  expect((await run()).body).toEqual({ n: 1 });
});
it('rate-limits after the limit', async () => {
  for (let i = 0; i < 3; i++) await enforceRateLimit(t.deps, 'ai:shop1', 3, 3600_000);
  await expect(enforceRateLimit(t.deps, 'ai:shop1', 3, 3600_000)).rejects.toMatchObject({
    status: 429,
    code: 'RATE_LIMITED',
  });
});
it('clamps page size and returns a next cursor', () => {
  expect(parsePage(new URLSearchParams('limit=500'))).toEqual({ cursor: null, limit: 100 });
  expect(toPage([1, 2, 3], 2, String)).toEqual({ items: [1, 2], nextCursor: '2' });
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(platform): add transactions with propagation, idempotency and rate limits`

---

### Task 4: Activity log

**Files:**

- Create: `src/server/modules/activity/actions.ts`, `src/server/modules/activity/canonical.ts`, `src/server/modules/activity/log.ts`, `src/server/modules/activity/query.ts`
- Test: `tests/api/activity-log.test.ts`

**Interfaces:**

- Consumes: `TxContext`, `withTransaction` (Task 3).
- Produces:
  - `ACTIONS`: the PRD §14 codes as dotted strings. Every later milestone uses exactly these:
    - Usual list: `usual_list.ai_suggested`, `usual_list.confirmed`, `usual_list.item_updated`
    - Basket: `basket.drafted`, `basket.line_added_by_staff`, `basket.line_changed`, `basket.fulfilment_changed`, `basket.approved`, `basket.skipped`, `basket.expired`
    - Payment and balance: `payment.created`, `payment.succeeded`, `payment.failed`, `payment.voided`, `balance.applied`, `refund.issued`
    - Round: `round.opened`, `round.closed`, `participation.joined`, `participation.cancelled`, `participation.dropped_price_limit`
    - Supplier order: `supplier_order.drafted`, `supplier_order.approved`, `supplier_order.rejected_by_ops`, `supplier_order.confirmed`, `supplier_order.rejected_by_supplier`, `supplier_order.dispatched`
    - Hub: `hub.check_recorded`, `hub.shortfall_allocated`, `hub.supplier_payout_released`
    - Fulfilment: `fulfilment.consignment_created`, `fulfilment.consignment_status_changed`, `fulfilment.pickup_ready`, `fulfilment.pickup_collected`, `fulfilment.delivered`
    - Check and claim: `check.delivery_check_submitted`, `claim.submitted`, `claim.approved`, `claim.rejected`
    - Shell and demo: `shell.signed_in`, `shell.role_switched`, `demo.skip_to_cutoff`, `demo.complete_other_rounds`, `demo.reset`, `log.verified`
  - `type LogEntryInput = { action: ActionCode; subjectType: string; subjectId: string; scope: { shopId?: string; supplierId?: string; operator?: boolean }; before?: Json; after?: Json; reason?: string; aiMetadata?: { model: string; lineCount: number; averageConfidence: number; suggestionRunId: string } }`
  - `appendLog(ctx: TxContext, entry: LogEntryInput): Promise<{ seq: bigint; hash: string }>`. The actor comes from `ctx.actor`; the time is `ctx.now`.
  - `canonicalJson(value: unknown): string`: sorted keys, no whitespace; bigint becomes a string, Date becomes an ISO string, `undefined` keys are dropped.
  - `verifyLogChain(prisma): Promise<{ valid: true; count: number } | { valid: false; firstBrokenSeq: string }>`
  - `queryLog(deps, caller, filter: { subjectType?: string; subjectId?: string; cursor: string | null; limit: number }): Promise<{ items: LogEntryView[]; nextCursor: string | null }>`
  - `type LogEntryView = { seq: string; occurredAt: string; actorType: ActorType; actorRole: Role | null; actorName: string | null; action: string; subjectType: string; subjectId: string; before: Json | null; after: Json | null; reason: string | null }`. Names are resolved here (R7).
  - Staff views drop money-like keys and replace `/RM [\d,]+\.\d{2}/g` in `reason` with `RM •••`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('chains each entry to the one before', async () => {
  await withTransaction(deps, sys, async (ctx) => {
    await appendLog(ctx, e('demo.reset'));
    await appendLog(ctx, e('round.opened'));
  });
  const [a, b] = await deps.prisma.activityLogEntry.findMany({ orderBy: { seq: 'asc' } });
  expect(a.prevHash).toBe('0'.repeat(64));
  expect(b.prevHash).toBe(a.hash);
  expect(await verifyLogChain(deps.prisma)).toEqual({ valid: true, count: 2 });
});
it('keeps sequence numbers consecutive when two transactions append at once', async () => {
  await Promise.all(
    Array.from({ length: 8 }, () =>
      withTransaction(deps, sys, (ctx) => appendLog(ctx, e('round.opened'))),
    ),
  );
  const seqs = (await deps.prisma.activityLogEntry.findMany({ orderBy: { seq: 'asc' } })).map((r) =>
    Number(r.seq),
  );
  expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect((await verifyLogChain(deps.prisma)).valid).toBe(true);
});
it('reports the first broken entry after tampering', async () => {
  // append 3 entries; as admin: alter table activity_log_entries disable trigger user; update … set reason = 'x' where seq = 2; enable trigger
  expect(await verifyLogChain(deps.prisma)).toEqual({ valid: false, firstBrokenSeq: '2' });
});
it('gives the same canonical form regardless of key order', () => {
  expect(canonicalJson({ b: 1, a: { d: 2n, c: [1, { z: 1, y: 2 }] } })).toBe(
    '{"a":{"c":[1,{"y":2,"z":1}],"d":"2"},"b":1}',
  );
});
it('shows staff only their own entries, with amounts hidden', async () => {
  // entries: by rahim (shop KEDAI_KOPI, reason "Full refund: RM 123.30", after { amountSen: 12330, quantity: 1 }) and by ahSeng
  const page = await queryLog(deps, personCaller(rahimSession), { cursor: null, limit: 20 });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({ reason: 'Full refund: RM •••', after: { quantity: 1 } });
  expect(page.items[0].after).not.toHaveProperty('amountSen');
});
it("shows owners only their shop's entries and suppliers only their orders", async () => {
  /* … */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement.
  - `appendLog` locks the head with `SELECT … FOR UPDATE` through `ctx.tx.$queryRaw`.
  - The hashed fields are exactly `{ seq, occurredAt, actorUserId, actorRole, actorType, shopId, supplierId, operatorScope, action, subjectType, subjectId, before, after, reason, aiMetadata }`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(activity): add the hash-chained activity log`

---

### Task 5: Ledger

**Files:**

- Create: `src/server/modules/ledger/accounts.ts`, `src/server/modules/ledger/post.ts`, `src/server/modules/ledger/checks.ts`
- Test: `tests/api/ledger.test.ts`

**Interfaces:**

- Produces:
  - `type AccountRef = { kind: 'shop_balance'; shopId: string } | { kind: 'round_hold'; roundId: string } | { kind: 'delivery_fee_hold'; shopId: string; deliveryDate: string } | { kind: 'supplier_payable'; supplierId: string } | { kind: 'fee_revenue' } | { kind: 'logistics_payable' } | { kind: 'claims_expense' } | { kind: 'partner_cash' }`
  - `accountKey(ref): string`. Keys:
    - `shop_balance:<shopId>`
    - `round_hold:<roundId>`
    - `delivery_fee_hold:<shopId>:<date>`
    - `supplier_payable:<supplierId>`
    - `fee_revenue`, `logistics_payable`, `claims_expense`, `partner_cash`
  - `post(ctx: TxContext, p: { from: AccountRef; to: AccountRef; amountSen: number; kind: PostingKind; refs?: { roundId?; participationId?; paymentId?; claimId?; supplierOrderId?; shopId?; supplierId? }; memo?: string }): Promise<void>`.
    - It throws on a non-positive or fractional amount.
    - It locks both account rows in key order.
    - A check violation becomes `unprocessable('BALANCE_WOULD_GO_NEGATIVE', …)`.
  - `balanceOf(db: Prisma.TransactionClient | PrismaClient, ref: AccountRef): Promise<number>`
  - `runMoneyChecks(prisma): Promise<{ allPassed: boolean; checks: { id: MoneyCheckId; label: string; passed: boolean; failures: { roundId?: string; participationId?: string; detail: string }[] }[] }>`
    - `MoneyCheckId` is one of: `balances_sum_to_zero`, `no_negative_balances`, `cached_balances_match_postings`, `round_holds_match_participations`, `participation_paid_equals_refunds_plus_allocated`, `kept_within_limits`, `final_not_above_starting`.
    - The rules are PRD §6.11. Round-hold expectations by round status:
      - `open`: Σ `paidSen` of active participations.
      - `formed`, `ordered`, `confirmed`, `dispatched`: Σ kept final lines.
      - `empty`, `failed`, `cancelled`, `at_hub`, `completed`: 0.

- [ ] **Step 1: Write the failing tests:**

```ts
it('moves money between accounts and keeps the books at zero', async () => {
  await withTransaction(deps, sys, (ctx) =>
    post(ctx, {
      from: { kind: 'partner_cash' },
      to: { kind: 'round_hold', roundId: R },
      amountSen: 98454,
      kind: 'payment_in',
    }),
  );
  expect(await balanceOf(deps.prisma, { kind: 'round_hold', roundId: R })).toBe(98454);
  expect(await balanceOf(deps.prisma, { kind: 'partner_cash' })).toBe(-98454);
  const report = await runMoneyChecks(deps.prisma);
  expect(report.checks.find((c) => c.id === 'balances_sum_to_zero')?.passed).toBe(true);
});
it('refuses to take a shop balance below zero', async () => {
  await expect(
    withTransaction(deps, sys, (ctx) =>
      post(ctx, {
        from: { kind: 'shop_balance', shopId: S },
        to: { kind: 'round_hold', roundId: R },
        amountSen: 1,
        kind: 'balance_applied',
      }),
    ),
  ).rejects.toMatchObject({ status: 422, code: 'BALANCE_WOULD_GO_NEGATIVE' });
});
it('refuses zero and fractional amounts', async () => {
  /* amountSen 0 and 1.5 → throws */
});
it('flags a cached balance that drifted from its postings', async () => {
  // as admin: update ledger_accounts set balance_sen = balance_sen + 1 where key = 'partner_cash'
  expect(
    (await runMoneyChecks(deps.prisma)).checks.find(
      (c) => c.id === 'cached_balances_match_postings',
    ),
  ).toMatchObject({ passed: false });
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS. The participation checks are exercised again in M4–M8.
- [ ] **Step 5: Commit:** `feat(ledger): add double-entry postings and money checks`

---

### Task 6: Notifications, approvals and integration events

**Files:**

- Create: `src/server/modules/notifications/notify.ts`, `src/server/modules/notifications/templates.ts`, `src/server/modules/notifications/query.ts`, `src/server/modules/approvals/approvals.ts`, `src/server/modules/integration/events.ts`
- Test: `tests/api/notifications-approvals-events.test.ts`

**Interfaces:**

- Produces:
  - `notify(ctx, input: { type: string; audience: { shopId?: string; supplierId?: string; operator?: boolean; userIds?: string[]; roles: Role[] }; link: string; message: (role: Role) => { title: string; body: string; whatsappText: string }; dedupeKey?: string }): Promise<number>`.
    - It returns the number created.
    - Recipients are active memberships matching the audience; one row per user and role; the dedupe key per row is `${dedupeKey}:${userId}`.
    - It throws when `whatsappText.length > 300`, or when a staff message matches `/RM\s?\d/`.
  - `whatsappShareUrl(text: string): string` → `https://wa.me/?text=<encodeURIComponent(text)>`.
  - `TEMPLATES`: an object of per-type message builders. Later milestones add their PRD §13 entries here.
  - `listNotifications(deps, caller, page)`, `markNotificationRead(deps, caller, id)`. Both are scoped to the active membership's user, role and org.
  - `createApproval(ctx, input: { type: ApprovalType; subjectType: string; subjectId: string; shopId?: string; supplierId?: string; assigneeRole: Role; amountSen?: number; summary: string; whyNeeded: string; evidence: Json; expiresAt?: Date }): Promise<{ id: string }>`. The proposer comes from `ctx.actor`.
  - `registerApprovalHandler(type: ApprovalType, h: { onApprove(ctx, request, input): Promise<void>; onReject(ctx, request, input): Promise<void> })`.
  - `decideApproval(deps, caller, id, input: { decision: 'approve' | 'reject'; reason?: string; note?: string; expectedDispatchDate?: string }): Promise<ApprovalView>`. Errors:
    - 404 when the request isn't visible to the caller
    - 403 when the caller's role ≠ `assigneeRole`
    - 409 when it isn't pending
    - 422 `REASON_REQUIRED` for a reject without a reason (PRD §12)
  - `listPendingApprovals(deps, caller): Promise<ApprovalView[]>`. Ops see Ops requests, suppliers their own org's, owners their shop's.
  - `type ApprovalView = { id; type; subjectType; subjectId; summary; whyNeeded; amountSen: number | null; evidence: Json; proposedBy: { type: ActorType; name: string | null }; status; createdAt; link: string }`.
  - `emitEvent(ctx, type: EventType, data: Record<string, unknown>): Promise<void>`. It throws when any key, at any depth, matches `/name|phone|email|address/i` (PRD §21). `EventType` is the PRD §21 list.
  - `listEvents(deps, caller)`: the latest 100, Ops only.

- [ ] **Step 1: Write the failing tests:**

```ts
it('notifies only the roles asked for', async () => {
  /* audience { shopId: KEDAI, roles: ['owner'] } → 1 row for ahSeng, none for rahim */
});
it('refuses staff text with amounts', async () => {
  await expect(
    withTransaction(deps, sys, (ctx) =>
      notify(ctx, {
        type: 'x',
        audience: { shopId: KEDAI, roles: ['staff'] },
        link: '/staff',
        message: () => ({ title: 't', body: 'RM 5.00', whatsappText: 'w' }),
      }),
    ),
  ).rejects.toThrow(/amount/);
});
it('caps WhatsApp text at 300 characters and builds a share link with no phone number', () => {
  expect(whatsappShareUrl('Pickup code 482 913')).toBe(
    'https://wa.me/?text=Pickup%20code%20482%20913',
  );
});
it('sends a deduplicated notification once', async () => {
  /* same dedupeKey twice → 1 row */
});
it('needs a reason to reject', async () => {
  registerApprovalHandler('supplier_order', handlerSpy);
  const id = await makeApproval({ type: 'supplier_order', assigneeRole: 'ops' });
  expect(await decide(nadia, id, { decision: 'reject' })).toMatchObject({
    status: 422,
    code: 'REASON_REQUIRED',
  });
});
it('lets only the assignee role decide', async () => {
  /* ahSeng approving an Ops request → 403; nadia approving → handler called once, status approved */
});
it('refuses event data that carries a name', async () => {
  await expect(
    withTransaction(deps, sys, (ctx) =>
      emitEvent(ctx, 'round.closed', { roundId: 'r', shop: { name: 'x' } }),
    ),
  ).rejects.toThrow(/name/);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: add notifications, approvals and the integration event outbox`

---

### Task 7: Deterministic seed of reference data

**Files:**

- Create: `prisma/seed/ids.ts`, `prisma/seed/network.ts`, `prisma/seed/catalogue.ts`, `prisma/seed/shops.ts`, `prisma/seed/sample-order.ts`, `prisma/seed/index.ts`, `prisma/seed/cli.ts`
- Modify: `package.json` (`db:seed`; `db:reset` gains `&& pnpm db:seed`)
- Test: `tests/api/seed.test.ts`, `tests/unit/seed-ids.test.ts`

**Interfaces:**

- Produces:
  - `uuidv5(name: string, namespace: string): string`; `SEED_NAMESPACE = '6f1c2a4e-8b7d-4c3e-9a51-2d0e7b6c5f84'`; `seedId(kind: string, key: string): string` = `uuidv5(`${kind}:${key}`, SEED_NAMESPACE)`.
  - Typed constants for index §5 (hubs, pickup points, suppliers, products with tiers and aliases, the 3 demo shops, 40 background shops, users, memberships, usual lists for Gerai and Kafe), plus `SAMPLE_ORDER_TEXT` and `SAMPLE_USUAL_PRICES_SEN` (index §5.6).
  - `type SeedUserKey = 'ahSeng' | 'rahim' | 'siti' | 'kumar' | 'mei' | 'danial' | 'farid' | 'lim' | 'priya' | 'nadia'`.
  - `seedReferenceData(ctx: TxContext, opts: { anchorMonday: Date }): Promise<void>`. Products get `scheduleAnchorWeek = isoWeekOf(anchorMonday)` (O5). Demo settings get `featuredProductId = seedId('product', 'CM')`.
  - `seedDemo(deps: AppDeps, opts: { anchorMonday: Date }): Promise<void>`. It wraps seeding phases in one `withTransaction` (timeout 60 s): now `seedReferenceData`; M4 appends `seedCurrentWeek`; M9 inserts `seedHistoryWeek` before it.
  - `pnpm db:seed` (`tsx prisma/seed/cli.ts`) runs `seedDemo` with `anchorMonday = mostRecentMonday0605(systemClock.now())`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('implements UUID v5 (Python documentation vector)', () => {
  expect(uuidv5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
    '886313e1-3b8a-5372-9b90-0c9aee199e5d',
  );
});
it('seeds the network, catalogue, shops and people', async () => {
  await seedDemo(deps, { anchorMonday: new Date('2026-11-01T22:05:00Z') });
  const p = deps.prisma;
  expect(
    await Promise.all([
      p.hub.count(),
      p.pickupPoint.count(),
      p.supplier.count(),
      p.product.count(),
      p.priceTier.count(),
      p.shop.count(),
      p.user.count(),
    ]),
  ).toEqual([2, 6, 3, 12, 36, 43, 10]);
  expect(await p.shop.count({ where: { isBackground: true } })).toBe(40);
});
it('gives every product a ladder the engine accepts', async () => {
  /* validateTiers(tiers, { buyAlonePriceSen }) ok for all 12 */
});
it('names every business "… Contoh"', async () => {
  /* every shop and supplier name matches /Contoh/ */
});
it('uses the same ids after a second seed into an empty database', async () => {
  /* two fresh databases → identical sorted product and shop ids */
});
it('anchors fortnightly products on the demo week', async () => {
  expect(
    (await deps.prisma.product.findUniqueOrThrow({ where: { id: seedId('product', 'CUPS') } }))
      .scheduleAnchorWeek,
  ).toBe('2026-W45');
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. Use `createMany` for reference rows; these inserts don't write log entries (reference data, not actions). **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Run `pnpm db:reset`. Expected: it ends with "Seeded 43 shops, 12 products".
- [ ] **Step 6: Commit:** `feat(seed): add deterministic reference data`

---

### Task 8: Simulated sign-in and sessions

**Files:**

- Create: `src/server/platform/session.ts`, `src/server/platform/session-page.ts`, `src/server/modules/identity/identity.ts`, `src/app/api/session/route.ts`, `src/app/api/session/active-membership/route.ts`
- Modify: `src/server/platform/http.ts` (`auth: 'session' | Role[]`, same-origin check, `idempotent` option); `tests/api/helpers/app.ts` (`createTestApp`, `Client`)
- Test: `tests/api/session.test.ts`

**Interfaces:**

- Produces:
  - `type Session = { userId: string; displayName: string; membership: { id: string; role: Role; orgType: OrgType; orgId: string; orgName: string; shopId?: string; supplierId?: string; operatorId?: string } }`.
  - `SESSION_COOKIE = 'bk_session'`.
  - `signSessionValue(payload: { u: string; m: string; iat: number }, secret: string): string` (`base64url(json).base64url(hmacSha256)`), and `verifySessionValue(value, secret): payload | null`.
  - `loadSession(deps, request: Request): Promise<Session | null>`: expired after 7 days of real time (`systemClock`), or with an ended membership → null.
  - `getPageSession(): Promise<Session | null>`, for server components only; it uses `cookies()`.
  - `listSignInAccounts(deps)`, `signIn(deps, input: { userId: string; provider: SignInProvider }, ip: string)`, `switchMembership(deps, caller, input: { membershipId?: string; userId?: string })`. Switching by `userId` works only in demo mode (C6).
  - The route wrapper now:
    - Loads the session for `auth: 'session'` or a role list; 401 when it's missing, 403 when the role isn't listed.
    - Rejects with 403 `CROSS_ORIGIN` a mutating request whose `Origin` header is present and differs from the request URL's origin. Exempt: `/api/engine/v1/*` and `/api/jobs/*`.
    - With `idempotent: true`, wraps the handler in `withIdempotency(scope = userId:method:path, key = Idempotency-Key header)`.
    - **Body size limit** (PRD §24 "Input size limits"): the option `maxBodyBytes` defaults to 1,048,576. Larger bodies get 400 `BODY_TOO_LARGE` before parsing. Photo endpoints (M13, M14) set 8,388,608.
    - Passes `{ session, caller }` to handlers.
  - Routes: `POST /api/session` (body `{ userId, provider }`; sets the cookie; rate limit 20 per IP per 10 minutes; logs `shell.signed_in`), `GET /api/session`, `DELETE /api/session`, `POST /api/session/active-membership` (logs `shell.role_switched`).
  - `createTestApp(opts?: { now?: string; seed?: 'none' | 'reference' | 'demo' })`. The default `'demo'` runs `seedDemo` at the anchor; `'reference'` runs `seedReferenceData` only. `TestApp.as(user)` and `TestApp.anonymous()` return a `Client` that keeps the cookie (index §4.5).

- [ ] **Step 1: Write the failing tests:**

```ts
it('signs in as a seeded owner with a signed, HTTP-only cookie', async () => {
  const res = await app
    .anonymous()
    .post('/api/session', { userId: seedId('user', 'ahSeng'), provider: 'microsoft' });
  expect(res.status).toBe(200);
  expect(res.headers.get('set-cookie')).toMatch(
    /bk_session=.+; Path=\/; .*HttpOnly; .*SameSite=Lax/i,
  );
  expect(res.body.activeMembership).toMatchObject({ role: 'owner', orgName: 'Kedai Kopi Contoh' });
});
it('rejects a tampered cookie with 401', async () => {
  const c = await app.as('rahim');
  c.tamperCookie(); // swaps the user id in the payload, keeps the old signature
  expect((await c.get('/api/session')).status).toBe(401);
});
it('switches between the user’s own memberships only', async () => {
  const ah = await app.as('ahSeng');
  expect(
    (
      await ah.post('/api/session/active-membership', {
        membershipId: seedId('membership', 'farid'),
      })
    ).status,
  ).toBe(404);
});
it('switches account in demo mode (C6)', async () => {
  const ah = await app.as('ahSeng');
  const r = await ah.post('/api/session/active-membership', { userId: seedId('user', 'nadia') });
  expect(r.body.activeMembership.role).toBe('ops');
});
it('refuses a cross-origin request', async () => {
  const ah = await app.as('ahSeng');
  expect(
    (
      await ah.post(
        '/api/session/active-membership',
        { membershipId: 'x' },
        { origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403);
});
it('rate-limits sign-in', async () => {
  /* 21st POST from one IP within 10 minutes → 429 */
});
it('refuses a body over 1 MB before parsing it', async () => {
  expect(
    (
      await app
        .anonymous()
        .post('/api/session', { userId: 'x'.repeat(1_100_000), provider: 'google' })
    ).body.code,
  ).toBe('BODY_TOO_LARGE');
});
it('logs the sign-in by id, not by name', async () => {
  const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
    where: { action: 'shell.signed_in' },
  });
  expect(JSON.stringify(entry)).not.toContain('Ah Seng');
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. Cookie attributes: `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=604800`, and `Secure` when `NODE_ENV === 'production'`. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(identity): add simulated Orbyte sign-in and sessions`

---

### Task 9: Permissions and the shell's API

**Files:**

- Create: `src/server/platform/permissions.ts`, `src/app/api/notifications/route.ts`, `src/app/api/notifications/[id]/read/route.ts`, `src/app/api/approvals/route.ts`, `src/app/api/approvals/[id]/approve/route.ts`, `src/app/api/approvals/[id]/reject/route.ts`, `src/app/api/activity/route.ts`, `src/app/api/activity/verify/route.ts`, `tests/api/helpers/scans.ts`
- Test: `tests/api/shell-api.test.ts`

**Interfaces:**

- Produces:
  - `requireRole(caller, roles: Role[])` (403); `requireShopAccess(caller, shopId, roles?: Role[])`; `requireSupplierAccess(caller, supplierId)`; `requireOps(caller)`.
    - `requireShopAccess`: owners and staff get 404 for another shop; suppliers get 404; Ops pass.
    - `requireSupplierAccess`: suppliers get 404 for another supplier; Ops pass; others 403.
    - System callers pass every check.
  - The routes are PRD §20 "Activity log, notifications" and "Approvals". `POST /api/activity/verify` is Ops-only, returns `{ valid: true, count }` or `{ valid: false, firstBrokenSeq }`, and logs `log.verified`.
  - `expectNoMoneyFields(value)` (index §4.5).

- [ ] **Step 1: Write the failing tests:**

```ts
it('lets only Ops verify the log', async () => {
  expect((await (await app.as('ahSeng')).post('/api/activity/verify')).status).toBe(403);
  expect((await (await app.as('nadia')).post('/api/activity/verify')).body).toMatchObject({
    valid: true,
  });
});
it('shows staff only their own log entries, with no money fields', async () => {
  const res = await (await app.as('rahim')).get('/api/activity');
  expect(res.body.items.every((i: any) => i.actorName === 'Rahim')).toBe(true);
  expectNoMoneyFields(res.body);
});
it('returns a timeline for a subject', async () => {
  /* GET /api/activity?subjectType=shop&subjectId=<KEDAI> as ahSeng → entries for that subject only */
});
it('pages notifications', async () => {
  /* create 25 for ahSeng → limit default 20, nextCursor set; second page 5 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(api): add permissions and the shell's notifications, approvals and activity routes`

---

### Task 10: Demo state and "Reset demo data"

**Files:**

- Create: `src/server/modules/demo/demo.ts`, `src/app/api/demo/state/route.ts`, `src/app/api/demo/reset/route.ts`
- Test: `tests/api/demo-reset.test.ts`

**Interfaces:**

- Produces:
  - `getDemoState(deps): Promise<{ demoMode: boolean; now: string; offsetMs: number; basketWeek: string; featuredProductId: string | null; featuredRoundId: string | null; bannerText: string }>`.
    - `bannerText`: `'Made-up data: every business, person and product here is fictional.'`
    - `featuredRoundId`: the featured product's open round, or else its latest round.
  - `resetDemo(deps, caller): Promise<DemoState>`, in one transaction (timeout 60 s):
    1. `SELECT pg_advisory_xact_lock(777001)`
    2. `SELECT bk_demo_reset()`
    3. Set `clock_offset_ms = 0`
    4. `appendLog(demo.reset)`
    5. `seedDemo` phases with a seed clock
    6. Set `clock_offset_ms = anchor − systemClock.now()`, where `anchor = mostRecentMonday0605(systemClock.now())`
    7. Set `last_reset_at`
  - `GET /api/demo/state` and `POST /api/demo/reset` for any signed-in role. Both return 404 `DEMO_OFF` when demo mode is off (PRD §24: demo controls exist only in demo mode).

- [ ] **Step 1: Write the failing tests:**

```ts
it('restores the seeded state with a new chain that starts with "demo reset"', async () => {
  const c = await app.as('nadia');
  await c.post('/api/demo/reset');
  const first = await app.prisma.activityLogEntry.findFirstOrThrow({ where: { seq: 1n } });
  expect(first.action).toBe('demo.reset');
  expect(await verifyLogChain(app.prisma)).toMatchObject({ valid: true });
  expect(await app.prisma.shop.count()).toBe(43);
});
it('ends in the same state when reset twice at once', async () => {
  const c = await app.as('nadia');
  await Promise.all([c.post('/api/demo/reset'), c.post('/api/demo/reset')]);
  expect(await app.prisma.shop.count()).toBe(43);
  expect((await verifyLogChain(app.prisma)).valid).toBe(true);
});
it('sets the demo clock to the most recent Monday 06:05', async () => {
  /* GET /api/demo/state → now === mostRecentMonday0605(real now), within 5 s */
});
it('hides demo controls when demo mode is off', async () => {
  await app.adminQuery('update demo_settings set demo_mode = false');
  expect((await (await app.as('nadia')).post('/api/demo/reset')).status).toBe(404);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(demo): add demo state and reset`

---

### Task 11: Visual direction (planned stop, D8)

**Files:**

- Create (temporary): `src/app/design-options/[option]/page.tsx`, `src/components/shell/design-tokens.ts`
- Modify: `src/app/globals.css` (the chosen tokens)

- [ ] **Step 1: Build three options**, each a token set in `design-tokens.ts` (CSS variables for background, surface, primary, accent, border, radius and font scale). Each renders the same two mock screens: the shell top bar with the banner, and an owner home with a basket card, a pickup card, a savings card and a "Approve & pay" button.
  - **Option 1, Orbyte navy:** a dark navy top bar (`#0d1117`), white type, blue primary (`#2f6fed`), amber accent (`#f5a623`), white cards with coloured top borders. This follows the Orbyte deck.
  - **Option 2, light Orbyte:** a white top bar with a navy wordmark, the same blue and amber, a soft grey background, and cards with a 4 px blue top border.
  - **Option 3, warm market:** a navy top bar, a teal primary (`#0f766e`), an amber accent, cream surfaces.

  Every option must pass WCAG AA for body text and buttons. Check the contrast ratios with a small script and record them on the page.

- [ ] **Step 2:** Run `pnpm dev` and take screenshots of `/design-options/1`, `/2` and `/3` at 390 × 844 and 1280 × 800 (Chrome DevTools MCP `take_screenshot`).
- [ ] **Step 3: STOP: ask the user to choose.** Use AskUserQuestion with the three options and a one-line description each, and ask them to open `http://localhost:3000/design-options/1` (and `/2`, `/3`) in their browser. Wait for the answer.
- [ ] **Step 4: Apply the choice.** Copy the chosen tokens into `globals.css` (`:root` variables used by shadcn/ui), delete `src/app/design-options/`, and record the choice in the milestone report.
- [ ] **Step 5: Commit:** `feat(ui): adopt the chosen visual direction`

---

### Task 12: The Orbyte shell

**Files:**

- Create:
  - Pages: `src/app/sign-in/page.tsx`, `src/app/(shell)/layout.tsx`, `src/app/(shell)/owner/page.tsx`, `src/app/(shell)/staff/page.tsx`, `src/app/(shell)/supplier/page.tsx`, `src/app/(shell)/ops/page.tsx`, `src/app/(shell)/approvals/page.tsx`, `src/app/(shell)/notifications/page.tsx`, `src/app/(shell)/activity/page.tsx`
  - Shell components: `src/components/shell/top-bar.tsx`, `src/components/shell/account-switcher.tsx`, `src/components/shell/made-up-data-banner.tsx`, `src/components/shell/demo-menu.tsx`
  - Shared components: `src/components/common/phone-column.tsx`, `src/components/common/empty-state.tsx`, `src/components/common/money.tsx`, `src/components/common/timeline.tsx`, `src/components/common/api-client.ts`
- Modify: `src/app/page.tsx` (redirect to `/sign-in` or the role home)

**Interfaces:**

- Produces these UI building blocks:
  - `<PhoneColumn>`: `max-w-[430px] mx-auto` on desktop.
  - `<EmptyState title explanation example />`
  - `<Money sen />`: `tabular-nums`, `formatRM`.
  - `<Timeline items: LogEntryView[] />`
  - `<DemoMenu>`, with "Reset demo data" in M2. M5 adds "Skip to cut-off" and M7 "Complete other rounds".
  - `apiFetch(path, init)`: JSON, sends `Idempotency-Key` for POSTs created with `crypto.randomUUID()`, and surfaces `{ code, message }` errors as toasts (shadcn `sonner`).
  - `requirePageRole(session, roles)`: redirects to `/sign-in` or the caller's own home.

- [ ] **Step 1: Build the sign-in page.**
  - "Continue with Microsoft" and "Continue with Google" buttons (labelled "Simulated").
  - A list of seeded accounts grouped by business. Each shows the person's name and role.
  - Choosing one calls `POST /api/session` and routes to its role home.
- [ ] **Step 2: Build the shell layout.**
  - **Top bar:** the BeliKongsi wordmark; the business and role switcher, with a role badge; the bell with the unread count; an approvals link with the pending count; an activity-log link; the demo menu (demo mode only).
  - **Banner:** "Made-up data" always visible in demo mode.
  - **Width:** owner and staff routes use `<PhoneColumn>`.
- [ ] **Step 3: Role homes and shared pages.**
  - Role homes are placeholders with empty states that say what will appear, with an example. For instance, owner: "Your weekly basket appears here every Monday at 6 am. Example: 5 items, RM 1,630.20."
  - **Notifications:** WhatsApp preview text plus a "Share via WhatsApp" button using `whatsappShareUrl`.
  - **Approvals:** what, how much, why, evidence, proposed by.
  - **Activity:** the timeline, plus "Verify log" for Ops, showing "Valid (N entries)" or "Broken at entry N".
- [ ] **Step 4: Verify** with Chrome DevTools MCP against `pnpm dev`:
  - Sign in as Ah Seng, Rahim, Farid and Nadia in turn at 390 × 844 (Nadia also at 1280 × 800).
  - Confirm: the banner is visible; the switcher lists every seeded account; staff see no money anywhere; tap targets are ≥ 44 px; and "Reset demo data" returns to the same screens.
- [ ] **Step 5:** Run `pnpm verify`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(ui): add the simulated Orbyte shell`

---

### Milestone verification

- [ ] Run `pnpm verify`. Expected: PASS. Then run `pnpm db:reset` and click through Task 12's checks once more.
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 1, 2, 91–93, 99, 101, 137–143, 145, 152, 155–157, 163, 166, 167, 179, 184), including the chosen visual direction.
