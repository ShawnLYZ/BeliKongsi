# M15 P1 Governance and Integration, and Final Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**

- Ops can filter and export the activity log, cancel an open round in an emergency, and rely on old photos being deleted after 90 days.
- Other Orbyte apps can subscribe to signed webhooks.
- Judges get an About page.
- The release closes out P0 and P1.

**Architecture:**

- Webhook deliveries are queued in the same transaction as the event that causes them (the outbox already exists from M2).
- A delivery worker inside `runDueJobs`, also triggered after commit, signs and sends them with a retry schedule and an SSRF guard.
- The fetch and DNS lookups go through an injectable HTTP adapter, so tests stay offline (G10).

**Tech Stack:** node:crypto (HMAC), node:dns, `fetch`, the M2–M14 services.

**Spec:** build design §9 P1-16 to P1-20; PRD stories 136, 144, 148, 161, 173; PRD §5 ("P1: open → cancelled"), §14 (P1 filters and export), §20 (activity export, round cancel), §21 (P1 webhooks), §25 (retention).

## Global Constraints

- Index §2 (G1–G10) applies.
- P1-17 webhooks:
  - registration is through the integration API with the simulated Orbyte app credential header `X-Orbyte-App-Id`, and the secret is shown once
  - each delivery is signed with HMAC-SHA256 over `timestamp + "." + body`
  - retries come after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours; after that the delivery is marked failed
  - private and loopback addresses are refused
  - a demo receiver is available at `/api/demo/webhook-receiver`
- PRD §21: event payloads carry ids, quantities, amounts and statuses only (already enforced by `emitEvent`).
- P1-18: a reason is required; full refunds; delivery fees refunded where no door lines remain; `round.cancelled` emitted; the next round opens unless Ops also pauses the product.
- P1-19: photos are deleted 90 days after upload, and the deletion is noted on the claim and logged.
- New action codes: `log.exported`, `round.cancelled`, `photo.deleted`, `webhook.subscribed`, `webhook.unsubscribed`.

## Review Focus

1. **A webhook URL that resolves to a private or loopback address, including a hostname that later changes its DNS answer:** refused at registration and checked again at delivery. Pinned in Task 2.
2. **A receiver that hangs:** a 5-second timeout counts as a failed attempt and follows the retry schedule. Pinned in Task 2.
3. **An emergency cancellation racing the cut-off close:** the round lock lets exactly one happen. Pinned in Task 3.
4. **Log entries whose reason contains a comma, a quote or a newline:** the CSV export stays valid. Pinned in Task 1.
5. **The photo deletion job finding the object already gone:** it marks the photo deleted without failing. Pinned in Task 4.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m15-p1-governance-integration`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names: `queryLog`, `emitEvent`, `runDueJobs`, `scheduleDueWork`, `closeRoundById` (locking), `refundDeliveryFeeIfUnused`, `openNextRound`, `StorageAdapter.deleteObject`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Log filters and CSV export (P1-16)

**Files:**

- Create: `src/app/api/activity/export/route.ts`, `src/server/modules/activity/export.ts`
- Modify: `src/server/modules/activity/query.ts` (filters), `src/app/api/activity/route.ts`, `src/app/(shell)/activity/page.tsx`
- Test: `tests/api/activity-filters-export.test.ts`

**Interfaces:**

- Produces:
  - `queryLog` filters: `{ from?: string; to?: string; actorUserId?: string; action?: string; subjectType?: string; subjectId?: string }`.
    - `from` and `to` are `YYYY-MM-DD` in MYT, inclusive.
    - The filters apply inside each role's visibility (PRD §15).
  - `exportLogCsv(deps, caller, filters): Promise<{ filename: string; csv: string }>`. Ops only, otherwise 403.
    - Columns: `seq, occurred_at_myt, actor_type, actor_role, actor_name, action, subject_type, subject_id, reason, before_json, after_json, hash`.
    - RFC 4180 quoting, UTF-8 with a BOM, filename `activity-log-<YYYY-MM-DD>.csv`.
    - It logs `log.exported` with the filters.

- [ ] **Step 1: Write the failing tests:** filters combine (`action` plus a date range); a date range is read in MYT (an entry at 23:30 MYT on the `to` date is included); the CSV header is exact; a reason containing `,`, `"` and a newline round-trips through a CSV parser; the export is logged; owners get 403.
- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(activity): filter the log and export it as CSV`

---

### Task 2: Signed webhooks with retries (P1-17)

**Files:**

- Create: `prisma/migrations/<ts>_p1_webhooks/migration.sql`, `src/server/adapters/http.ts`, `src/server/modules/integration/webhooks.ts`, `src/server/modules/integration/ssrf.ts`, `src/app/api/integrations/v1/webhooks/route.ts`, `src/app/api/integrations/v1/webhooks/[id]/route.ts`, `src/app/api/demo/webhook-receiver/route.ts`, `docs/integrations.md`
- Modify:
  - `prisma/schema.prisma`:
    - `WebhookSubscription` (`webhook_subscriptions`): id, appId, url, eventTypes String[], secret, active, createdAt
    - `WebhookDelivery` (`webhook_deliveries`): id, subscriptionId, eventId, attempt Int, status ('pending' | 'succeeded' | 'failed'), nextAttemptAt, lastStatusCode?, lastError?, createdAt, updatedAt; unique (subscriptionId, eventId)
    - `DemoWebhookReceipt` (`demo_webhook_receipts`): id, deliveryId, receivedAt, signatureValid Boolean, body Json
    - The migration ends with `SELECT bk_secure_all_tables();`.
  - `src/server/modules/integration/events.ts`: `emitEvent` enqueues a delivery for each matching active subscription, in the same transaction.
  - `src/server/modules/jobs/run.ts`: `deliverDueWebhooks`.
  - `src/server/platform/deps.ts`: `AppDeps.http: { fetch: typeof fetch; lookup: (host: string) => Promise<string[]> }`.
  - `src/app/(shell)/ops/events/page.tsx`: subscriptions, delivery attempts and demo receipts.
- Test: `tests/api/webhooks.test.ts`, `tests/unit/ssrf.test.ts`

**Interfaces:**

- Produces:
  - `RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]`. Six attempts in all; after the sixth failure the delivery becomes `failed`.
  - `signWebhook(secret: string, timestamp: number, body: string): string`. It returns `'v1=' + hex(HMAC-SHA256(secret, `${timestamp}.${body}`))`.
  - `isForbiddenAddress(ip: string): boolean`. It refuses 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, ::1, fc00::/7, fe80::/10 and IPv4-mapped IPv6 forms of these.
  - `assertSafeWebhookUrl(deps, url: string, ownOrigin: string): Promise<void>`:
    - HTTPS only, except the app's own `/api/demo/webhook-receiver` on `ownOrigin`, which may be `http://localhost` in development.
    - Every resolved address must pass `isForbiddenAddress`, otherwise 422 `UNSAFE_WEBHOOK_URL`.
  - `registerWebhook(deps, appId, { url, eventTypes })`: returns `{ id, url, eventTypes, secret }`. The secret is 32 random bytes in base64url and is returned only here. It logs `webhook.subscribed`.
  - `listWebhooks(deps, appId)` and `deleteWebhook(deps, appId, id)`. Another app's subscription gets 404. Deleting logs `webhook.unsubscribed`.
  - Requests need `X-Orbyte-App-Id`, otherwise 401 `APP_ID_REQUIRED`.
  - `deliverDueWebhooks(deps): Promise<{ attempted: number; succeeded: number; failed: number }>`:
    - It selects up to 50 pending deliveries with `nextAttemptAt ≤ now` using `FOR UPDATE SKIP LOCKED`, and re-checks the address.
    - It POSTs the body `{ id, type, version, occurredAt, data }` with the headers `X-BeliKongsi-Event`, `X-BeliKongsi-Delivery`, `X-BeliKongsi-Timestamp` (Unix seconds) and `X-BeliKongsi-Signature`, and a 5-second timeout.
    - A 2xx response means `succeeded`. Anything else records the error and schedules the next attempt from `RETRY_DELAYS_MS`.
  - The demo receiver (demo mode only) verifies the signature against the subscription found through the delivery id, and stores a `DemoWebhookReceipt`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('signs deliveries the receiver can verify', () => {
  expect(signWebhook('s3cret', 1762380000, '{"a":1}')).toBe(
    'v1=' + createHmac('sha256', 's3cret').update('1762380000.{"a":1}').digest('hex'),
  );
});
it.each([
  '10.0.0.5',
  '127.0.0.1',
  '169.254.169.254',
  '192.168.1.1',
  '::1',
  '::ffff:127.0.0.1',
  'fd00::1',
])('refuses %s', (ip) => expect(isForbiddenAddress(ip)).toBe(true));
it('refuses a hostname that resolves to a private address at registration and again at delivery', async () => {
  /* lookup stub returns 10.0.0.5 → 422; a stub that changes to 127.0.0.1 after registration → delivery fails without a request */
});
it('queues deliveries in the same transaction as the event', async () => {
  /* event inside a transaction that rolls back → no webhook_deliveries row */
});
it('retries on the schedule and gives up after the last retry', async () => {
  // fetch stub returns 500; run deliverDueWebhooks, advancing the clock by each RETRY_DELAYS_MS step
  // nextAttemptAt deltas = [1 min, 5 min, 30 min, 2 h, 12 h]; after the 6th attempt the status is 'failed'
});
it('treats a 5-second timeout as a failed attempt', async () => {
  /* fetch never resolves → abort at 5 s → attempt 1 failed, next in 1 min */
});
it('delivers to the demo receiver and shows the signature as valid (story 161)', async () => {
  /* register the receiver; trigger round.closed; deliver → DemoWebhookReceipt.signatureValid true */
});
it("never lets one app remove another app's subscription", async () => {
  /* → 404 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. Write `docs/integrations.md`: registration, headers, signature verification in about 10 lines of Node, the retry schedule, the event catalogue and the demo receiver. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(integration): signed webhooks with retries and an SSRF guard`

---

### Task 3: Emergency round cancellation (P1-18)

**Files:**

- Create: `src/app/api/rounds/[roundId]/cancel/route.ts`
- Modify: `src/server/modules/rounds/cancel.ts` (add `cancelOpenRound`), `src/server/modules/notifications/templates.ts` (`round.cancelled_emergency`)
- Test: `tests/api/emergency-cancel.test.ts`

**Interfaces:**

- Produces: `cancelOpenRound(deps, caller, roundId, { reason: string; pauseProduct?: boolean }): Promise<{ refundedSen: number; nextRoundId: string | null }>` (Ops).
  - It locks the round with `FOR UPDATE`; a round that isn't open gets 409 `ROUND_NOT_OPEN`; a missing reason gets 422 `REASON_REQUIRED`.
  - Every `active` participation becomes `refunded_round_cancelled`, posting `round_hold → shop_balance` (`refund_round_cancelled`) for its `paidSen`. `refundDeliveryFeeIfUnused` runs.
  - The round becomes `cancelled`. It logs `round.cancelled` and emits `round.cancelled { roundId, by: 'ops', reasonCode: 'emergency' }` and `refund.issued { kind: 'full' }`.
  - Owner notice: `BeliKongsi cancelled this week's {shortName} Kongsi: {reason}. Full refund: {RM}.`
  - With `pauseProduct`, the product becomes inactive. Otherwise `openNextRound(now)` runs.

- [ ] **Step 1: Write the failing tests:**
  - It refunds everyone in full, and the hold is 0 (story 136).
  - The next round opens with the following Thursday cut-off, unless the product is paused.
  - A missing reason gets 422; a non-Ops caller gets 403.
  - Racing `closeRoundById` and `cancelOpenRound` at cut-off with two clients: exactly one succeeds and the other is `skipped` or 409; there is one set of refunds.
- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(rounds): emergency cancellation of open rounds`

---

### Task 4: Deleting photos after 90 days (P1-19)

**Files:**

- Create: `src/server/modules/checks/photo-retention.ts`
- Modify: `src/server/modules/jobs/run.ts`, `src/server/modules/checks/claims.ts` (the claim view shows "Photo deleted after 90 days")
- Test: `tests/api/photo-retention.test.ts`

**Interfaces:**

- Produces: `deletePhotosPastRetention(deps): Promise<{ deleted: number }>`. For photos with `deleteAfter ≤ now` and no `deletedAt`:
  - Call `storage.deleteObject`; an object that's already missing is not an error.
  - Set `deletedAt` and log `photo.deleted` (system).

- [ ] **Step 1: Write the failing tests:**
  - A photo uploaded on 10 Nov is kept at +89 days and deleted at +90 days (story 148).
  - The claim view then shows "Photo deleted after 90 days" instead of a link.
  - An object removed by hand beforehand is still marked deleted without an error.
- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(privacy): delete delivery photos after 90 days`

---

### Task 5: The About page (P1-20)

**Files:**

- Create: `src/app/about/page.tsx`
- Modify: `src/app/sign-in/page.tsx` (an "About BeliKongsi" link), `src/app/(shell)/layout.tsx` (a footer link)

- [ ] **Step 1: Build `/about`.** It's public and needs no session (story 173). Sections:
  - **The problem:** PRD "The problem, precisely".
  - **The five-step journey:** the PRD table.
  - **How it fits Orbyte:** shared sign-in, roles, approvals, notifications and audit trail; partners; the Engine API and webhooks.
  - **SDG contribution:** SDG 8 (8.2, 8.3) and SDG 10.
  - **Privacy (PDPA):** the PRD §25 table in short.
  - **What's simulated:** payments, payouts, logistics, sign-in, WhatsApp; and "Made-up data".
- [ ] **Step 2: Verify.** Signed out, `/about` renders at 390 × 844 and 1280 × 800, and Lighthouse accessibility is at least 95.
- [ ] **Step 3: Commit:** `feat: add the About page`

---

### Task 6: Final release

**Files:**

- Modify: `README.md` (P1 features, links to `docs/integrations.md`, status "P0 and P1 complete"), `docs/deployment.md` (any P1 notes, e.g. the webhook demo receiver URL), `src/components/shell/*` (links to new pages)

- [ ] **Step 1:** Update the README and deployment guide. Run `pnpm check:secrets --all`. Expected: PASS.
- [ ] **Step 2:** Run `pnpm verify` (including `e2e`), `FC_NUM_RUNS=5000 pnpm test:engine` and `pnpm predemo --skip-ai`. Expected: all pass.
- [ ] **Step 3:** Rehearse the PRD §23 demo script once more in a production build with `AI_ADAPTER=gemini`. Check each P1 feature once by hand: auto-approve, withdrawal, export, a late cancellation after advancing the demo clock, partial collection, supplier tier editing, price-list import, invoice photo, the impact panel, the log CSV, a webhook delivery to the demo receiver, emergency cancellation, the About page.
- [ ] **Step 4: Commit:** `docs: final release notes for P0 and P1`
- [ ] **Step 5:** Merge to `main` with `--ff-only` and post the final report: **P0 and P1 complete**, with every story by milestone, test results, the reset time, the Gemini model and its scores, and the user's deployment steps from `docs/deployment.md`.
