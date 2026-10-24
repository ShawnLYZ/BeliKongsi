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
- New action codes: `log.exported`, `round.cancelled`, `photo.deleted`, `webhook.subscribed`, `webhook.unsubscribed`. Each is added to `ACTIONS` in `src/server/modules/activity/actions.ts` by the task that first logs it (`appendLog` accepts only listed codes).

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

**Re-sync notes (2026-10-24):**

- `queryLog(deps, caller, { subjectType?, subjectId?, subjects?, cursor, limit })` has no date, actor or action filters yet, and its `LogEntryView` has no `hash`. Task 1 adds the filters, and the export reads rows (with `hash`) itself. `parsePage` returns `{ cursor, limit }`.
- `emitEvent(ctx: TxContext, type, data)` takes a `TxContext`, not `deps`; `EventType` is only a type (no runtime list). Task 2 adds an `EVENT_TYPES` array for validating `eventTypes`. The event table is `IntegrationEvent` (`id`, `seq`, `type`, `version`, `occurredAt`, `data`).
- `runDueJobs(deps)` returns a `JobsReport` of counters; Task 2 adds `deliveredWebhooks` (and Task 4 `deletedPhotos`) to it. `scheduleDueWork(deps)` (in `src/server/platform/due-work.ts`, not in `jobs/`) runs `runDueJobs` after the response at most once per 30 s, so webhooks are "also triggered after commit" only through `after()` in the route or action that commits (Task 2 adds a small `after(() => deliverDueWebhooks(deps))` helper). `POST /api/jobs/run` needs `CRON_SECRET`.
- `AppDeps` has no `http`; its only construction outside `getDeps()` is `createTestDeps` in `tests/api/helpers/app.ts` (a `fixedClock`, a temp local storage dir). Task 2 adds `http` to both, with a stubbable fake in the test deps.
- The integration surface that exists is `/api/engine/v1/*` (public routes, `X-Orbyte-App-Id` only logged by `logAppId`, no registry of apps). There is no `/api/integrations/v1/`; Task 2 creates it. `route()` skips the origin check only for `/api/engine/v1/` and `/api/jobs/` (`ORIGIN_EXEMPT` in `src/server/platform/http.ts`), so Task 2 adds `/api/integrations/v1/`. The app id is a free-text header, so `APP_ID_REQUIRED` is the only check (same cleaning as `logAppId`, at most 64 characters).
- `cancelRoundWithRefunds(ctx, roundId, { by, reason })` in `rounds/cancel.ts` handles `kept` lines of a closed round (after cut-off, on Ops or supplier rejection). It does not log, does not open a next round, and its event reason codes are `ops_rejected` / `supplier_rejected`. Task 3 adds `cancelOpenRound` beside it for `active` lines of an `open` round; it reuses the same lock order, `post`, `refundDeliveryFeeIfUnused(ctx, shopId, deliveryDate)` (returns sen refunded, takes `lockShop`), `freePickupsOf` and the `refund.issued` log and event.
- `closeRoundById(deps, roundId): Promise<{ outcome }>` locks `rounds ... FOR UPDATE`, then `active` participations; it returns `skipped` when the round is not `open` or its cut-off is ahead. It opens the next round at the closed round's `cutoffAt` when `product.active`. `openNextRound(ctx, productId, opensAt): Promise<Round>` computes the cut-off with `nextCutoffAfter(product, opensAt)`, so Task 3 must pass the cancelled round's `cutoffAt`, not `now`, to get the following Thursday.
- `StorageAdapter.deleteObject(bucket, key): Promise<void>` exists (local and Supabase); the local one ignores a missing file. `Photo` already has `deleteAfter`, `deletedAt` and `storagePurgedAt` (set by `directory/deletion.ts` for anonymised shops). `sweepDeletedPhotos(deps)` already removes files of rows with `deletedAt` and no `storagePurgedAt`. Task 4 therefore only marks expired rows deleted (and logs); the existing sweep removes the file.
- The claim view (`getClaimForCaller`, `ClaimView.lines[].photoUrls`) filters `deletedAt: null`, so a deleted photo simply disappears today; Task 4 adds a `photosDeleted` flag.
- `ACTIONS` (`activity/actions.ts`) is a closed list and `appendLog` takes `ActionCode`; none of the five new codes exist. `round.cancelled` is only an integration event type today. Task 1, 2, 3 and 4 add their codes to `ACTIONS` and a label in `src/components/common/timeline.tsx` (`ACTION_LABELS`; the fallback label is acceptable).
- Participation status `refunded_round_cancelled`, posting kind `refund_round_cancelled`, accounts `round_hold` / `shop_balance`, round status `cancelled` and the product `active` flag all exist. The notification template `owner.order_rejected` is the closest existing one; `round.cancelled_emergency` is new. Templates are keyed in `TEMPLATES` via `defineTemplates` in `notifications/templates.ts`, and `notify` is called with `{ type, audience, link, message, dedupeKey }`.
- Migrations: the latest is `20261029090000_usual_list_photo_run`. `bk_secure_all_tables()` regrants the app role full access to `demo_settings`, so a migration that calls it must restate the `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "demo_settings" FROM bk_app; GRANT UPDATE (...)` lines, as earlier migrations do. `bk_demo_reset()` truncates every table, so the reset also clears webhook tables (the seed creates no subscriptions).
- Demo mode: `requireDemoMode(deps)` in `modules/demo/demo.ts` (reads `demo_settings.demoMode`, throws 404 `DEMO_OFF`) is what the demo receiver uses; `deps.env.DEMO_MODE` is a separate env flag used only by the usual-list saved example.
- UI: there is no shell footer; `src/app/(shell)/layout.tsx` renders `TopBar`, the banner and `<main>`. Ops pages are linked from `ITEMS` in `src/app/(shell)/ops/layout.tsx`. `src/app/(shell)/ops/events/page.tsx` already has a "coming later" paragraph about webhooks that Task 2 replaces. `/ops/rounds/[roundId]` (with `components/ops/round-detail.tsx`) is where Task 3's cancel button goes. The activity page is `src/app/(shell)/activity/page.tsx` (feed `components/shell/activity-feed.tsx`, ops-only `VerifyLogButton`).
- `requireOps(caller)` in `platform/permissions.ts` gives 403 to anyone else. Tests build deps with `createTestApp` (`tests/api/helpers/app.ts`): a `MutableClock` (`clock.set` / `clock.advance`) at `2026-11-01T22:05:00Z` by default, `app.deps.storage` over a temp dir, and `app.as(...)` clients.

---

### Task 1: Log filters and CSV export (P1-16)

**Files:**

- Create: `src/app/api/activity/export/route.ts`, `src/server/modules/activity/export.ts`
- Modify: `src/server/modules/activity/query.ts` (filters), `src/server/modules/activity/actions.ts` (`log.exported`), `src/app/api/activity/route.ts` (reads the filter query parameters), `src/app/(shell)/activity/page.tsx` and `src/components/shell/activity-feed.tsx` (a filter form and an Ops-only export link, passing the filters to the feed's next-page requests)
- Test: `tests/api/activity-filters-export.test.ts`

**Interfaces:**

- Produces:
  - `queryLog(deps, caller, filter)` keeps its signature; `filter` (today `{ subjectType?, subjectId?, subjects?, cursor, limit }`) gains `from?: string; to?: string; actorUserId?: string; action?: string`.
    - `from` and `to` are `YYYY-MM-DD` in MYT, inclusive: `occurredAt >= mytInstant(from, 00:00)` and `< mytInstant(to + 1 day, 00:00)` (`mytInstant` and `mytDate` are in `src/lib/time.ts`). A malformed date gets 400.
    - `where.actorUserId` is also set by the staff visibility rule; a filter `actorUserId` must be combined with it (`AND`), not overwrite it.
    - The filters apply inside each role's visibility (PRD §15).
  - `exportLogCsv(deps, caller, filters): Promise<{ filename: string; csv: string }>`. Ops only (`requireOps`), otherwise 403. It queries `activityLogEntry` directly in `seq` order (no 100-row page limit; it pages through the table in batches) because `LogEntryView` has no `hash`; actor names come from `user.displayName` as in `queryLog`. The date in the filename is `mytDate(now)`.
    - Columns: `seq, occurred_at_myt, actor_type, actor_role, actor_name, action, subject_type, subject_id, reason, before_json, after_json, hash`.
    - RFC 4180 quoting, UTF-8 with a BOM, filename `activity-log-<YYYY-MM-DD>.csv`.
    - It logs `log.exported` (subject `log` / `activity`, scope `{ operator: true }`, `after` = the filters and the row count).

- [ ] **Step 1: Write the failing tests:** filters combine (`action` plus a date range); a date range is read in MYT (an entry at 23:30 MYT on the `to` date is included); the CSV header is exact; a reason containing `,`, `"` and a newline round-trips through a CSV parser; the export is logged; owners get 403.
- [ ] **Step 2:** Run. **Step 3:** Implement; the route is `GET /api/activity/export` with the same query parameters, `auth: ['ops']`, answering `text/csv; charset=utf-8` with `Content-Disposition: attachment`. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(activity): filter the log and export it as CSV`

---

### Task 2: Signed webhooks with retries (P1-17)

**Files:**

- Create: `prisma/migrations/<ts>_p1_webhooks/migration.sql` (`<ts>` after `20261029090000`), `src/server/adapters/http.ts`, `src/server/modules/integration/webhooks.ts`, `src/server/modules/integration/ssrf.ts`, `src/app/api/integrations/v1/webhooks/route.ts`, `src/app/api/integrations/v1/webhooks/[id]/route.ts`, `src/app/api/demo/webhook-receiver/route.ts`, `docs/integrations.md`
- Modify:
  - `prisma/schema.prisma`:
    - `WebhookSubscription` (`webhook_subscriptions`): id, appId, url, eventTypes String[], secret, active, createdAt
    - `WebhookDelivery` (`webhook_deliveries`): id, subscriptionId, eventId, attempt Int, status ('pending' | 'succeeded' | 'failed'), nextAttemptAt, lastStatusCode?, lastError?, createdAt, updatedAt; unique (subscriptionId, eventId)
    - `DemoWebhookReceipt` (`demo_webhook_receipts`): id, deliveryId, receivedAt, signatureValid Boolean, body Json
    - The migration ends with `SELECT bk_secure_all_tables();` followed by the `demo_settings` `REVOKE` / `GRANT UPDATE ("clock_offset_ms", "seed_version", "last_reset_at", "featured_product_id")` lines copied from `20261022180000_payment_fee_dates`.
  - `src/server/modules/integration/events.ts`: add `EVENT_TYPES` (a `const` array that `EventType` is derived from). `emitEvent(ctx, type, data)` creates the event and then, through `ctx.tx`, a `pending` delivery (`attempt 0`, `nextAttemptAt = ctx.now`) for each active subscription whose `eventTypes` holds the type, so it commits or rolls back with the event.
  - `src/server/modules/activity/actions.ts`: `webhook.subscribed`, `webhook.unsubscribed`.
  - `src/server/platform/http.ts`: add `/api/integrations/v1/` to `ORIGIN_EXEMPT`.
  - `src/server/modules/jobs/run.ts`: call `deliverDueWebhooks` in `runDueJobs` and add `deliveredWebhooks: number` (the succeeded count) to `JobsReport`; update any test that compares a whole `JobsReport`. Also trigger it after commit: wrap `after(() => deliverDueWebhooks(deps))` (failure logged, never thrown) in a small helper next to `scheduleDueWork` in `src/server/platform/due-work.ts` and call it from the webhook routes and the demo actions that close rounds, so a demo needs no wait.
  - `src/server/platform/deps.ts`: `AppDeps.http: { fetch: typeof fetch; lookup: (host: string) => Promise<string[]> }`, built in `getDeps()` from `src/server/adapters/http.ts` (real `fetch` and `node:dns/promises` `lookup`, all addresses). `tests/api/helpers/app.ts` `createTestDeps` (the only other place that builds `AppDeps`) gets a stub that never touches the network; tests override `fetch` and `lookup`.
  - The demo receiver calls `requireDemoMode(deps)` from `src/server/modules/demo/demo.ts`.
  - `src/app/(shell)/ops/events/page.tsx` (plus a new `src/components/ops/webhooks-panel.tsx`): subscriptions, delivery attempts and demo receipts. It replaces the existing "coming later" paragraph about webhooks. The data comes from a new `listWebhookActivity(deps, caller)` that uses `requireOps`.
- Test: `tests/api/webhooks.test.ts`, `tests/unit/ssrf.test.ts`

**Interfaces:**

- Produces:
  - `RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]`. Six attempts in all; after the sixth failure the delivery becomes `failed`.
  - `signWebhook(secret: string, timestamp: number, body: string): string`. It returns `'v1=' + hex(HMAC-SHA256(secret, `${timestamp}.${body}`))`.
  - `isForbiddenAddress(ip: string): boolean`. It refuses 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, ::1, fc00::/7, fe80::/10 and IPv4-mapped IPv6 forms of these.
  - `assertSafeWebhookUrl(deps, url: string, ownOrigin: string): Promise<void>`:
    - HTTPS only, except the app's own `/api/demo/webhook-receiver` on `ownOrigin` (from `new URL(request.url).origin`, not a header), which may be `http://localhost` in development.
    - Every resolved address must pass `isForbiddenAddress`, otherwise 422 `UNSAFE_WEBHOOK_URL`.
  - `registerWebhook(deps, appId, { url, eventTypes })`: returns `{ id, url, eventTypes, secret }`. The secret is 32 random bytes in base64url and is returned only here. It logs `webhook.subscribed`.
  - `listWebhooks(deps, appId)` and `deleteWebhook(deps, appId, id)`. Another app's subscription gets 404. Deleting logs `webhook.unsubscribed`.
  - Requests need `X-Orbyte-App-Id` (cleaned like `logAppId` in `engine-api.ts`: control characters removed, at most 64 characters), otherwise 401 `APP_ID_REQUIRED`. The routes use `route({ auth: 'public' })`, which gives `caller: null`, so the services log and emit with `systemCaller('webhooks')`; `webhook.subscribed` / `unsubscribed` carry the app id in `after`, never the secret.
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

- Create: `src/app/api/rounds/[roundId]/cancel/route.ts` (`POST`, `route({ auth: ['ops'], body, idempotent: true })`; the directory `src/app/api/rounds/[roundId]/` already holds `route.ts`, `participations/` and `quote/`), `src/components/ops/cancel-round-form.tsx`
- Modify: `src/server/modules/rounds/cancel.ts` (add `cancelOpenRound` beside `cancelRoundWithRefunds`), `src/server/modules/notifications/templates.ts` (`round.cancelled_emergency`), `src/server/modules/activity/actions.ts` (`round.cancelled`), `src/components/ops/round-detail.tsx` (a cancel button with a reason field on open rounds, in the page `src/app/(shell)/ops/rounds/[roundId]/page.tsx`)
- Test: `tests/api/emergency-cancel.test.ts`

**Interfaces:**

- Produces: `cancelOpenRound(deps, caller, roundId, { reason: string; pauseProduct?: boolean }): Promise<{ refundedSen: number; nextRoundId: string | null }>` (Ops).
  - It runs in `withTransaction` and calls `requireOps(caller)`. A missing or blank reason gets 422 `REASON_REQUIRED`. It then locks as `closeRoundById` does: the round (`SELECT ... FOR UPDATE`), then its `active` participations (`ORDER BY id FOR UPDATE`), then each affected shop with `lockShop` in id order. A round whose status isn't `open` gets 409 `ROUND_NOT_OPEN` (a close that won the race leaves it `formed`, `failed` or `empty`). Unlike `closeRoundById` it does not check the cut-off: an `open` round past its cut-off but not yet closed can still be cancelled.
  - Every `active` participation becomes `refunded_round_cancelled` (`outcomeReason` = the reason), posting `round_hold → shop_balance` (`refund_round_cancelled`) for its `paidSen` (`finalAllInSen` is not set on an open round, unlike the `kept` lines `cancelRoundWithRefunds` refunds). Once the lines are updated, `refundDeliveryFeeIfUnused(ctx, shopId, deliveryDate)` runs for each distinct door shop and date, and `freePickupsOf(ctx, parts)` frees the pickups.
  - The round becomes `cancelled`. It logs `round.cancelled` (subject `round`, scope `{ supplierId, operator: true }`, the reason, `after` = `{ refundedSen }`) and a `refund.issued` entry per shop as `cancelRoundWithRefunds` does, and emits `round.cancelled { roundId, by: 'ops', reasonCode: 'emergency' }` and, per shop, `refund.issued { shopId, amountSen, kind: 'full', referenceId: roundId }`. `EventType` already has both.
  - Owner notice, type `round.cancelled_emergency` (audience `{ shopId, roles: ['owner'] }`, link `/owner/kongsi`, dedupe key `round.cancelled_emergency:{roundId}:{shopId}`, not sent to background shops, as in `cancelRoundWithRefunds`): `BeliKongsi cancelled this week's {shortName} Kongsi: {reason}. Full refund: {RM}.` The template is a builder `(data: { shortName; reason; refundSen }) => () => message` in `TEMPLATES`, using `formatRM`.
  - With `pauseProduct`, the product's `active` becomes `false` and `nextRoundId` is null. Otherwise `openNextRound(ctx, productId, round.cutoffAt)` runs, with the cancelled round's cut-off as `opensAt` exactly as the close does, so the next cut-off is the following Thursday (`nextCutoffAfter(product, now)` would pick the same Thursday again); its id is `nextRoundId`. A product that is already inactive opens no round.

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
- Modify: `src/server/modules/jobs/run.ts` (call it in `runDueJobs` before `sweepDeletedPhotos`; add `deletedPhotos: number` to `JobsReport`), `src/server/modules/activity/actions.ts` (`photo.deleted`), `src/server/modules/checks/claims.ts` (`getClaimForCaller` selects only `deletedAt: null` photos today, so a deleted photo just vanishes; it must also count the deleted ones per line and expose `photosDeleted: number` on `ClaimView.lines[]`), `src/components/ops/claim-review.tsx` (shows "Photo deleted after 90 days")
- Test: `tests/api/photo-retention.test.ts`

**Interfaces:**

- Produces: `deletePhotosPastRetention(deps): Promise<{ deleted: number }>`. `photos.ts` already sets `Photo.deleteAfter` to upload time + 90 days, and `Photo` already has `deletedAt` and `storagePurgedAt`. For photos with `deleteAfter ≤ now` and no `deletedAt` (oldest first, one batch per run, like `sweepDeletedPhotos`):
  - In a `withTransaction(deps, systemCaller('delete photos'), ...)`, set `deletedAt = now` and log `photo.deleted` (subject `photo`, scope `{ shopId: pickup.shopId }`, `after` = `{ pickupId }`).
  - Then call `storage.deleteObject('delivery-photos', storageKey)` (local storage ignores a missing file; treat a thrown "not found" as success too) and set `storagePurgedAt`. If the storage call fails, leave `storagePurgedAt` empty: the existing `sweepDeletedPhotos` retries it on the next run.

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
- Modify: `src/app/sign-in/page.tsx` (an "About BeliKongsi" link), `src/app/(shell)/layout.tsx` (it has no footer yet: add a small `<footer>` after `<main>` with the link)
- There is no proxy or middleware; pages guard themselves (`getPageSession`, `requirePageRole`), and `src/app/sign-in/page.tsx` is already public, so `/about` only has to avoid those. Check that `src/app/page.tsx` does not redirect `/about`.

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

- Modify: `README.md` (P1 features, links to `docs/integrations.md`, status "P0 and P1 complete"), `docs/deployment.md` (any P1 notes, e.g. the webhook demo receiver URL), `src/app/(shell)/ops/layout.tsx` (`ITEMS`, only if a new Ops page was added) and `src/components/shell/*` (only if a link to a new page belongs there; the shell has no footer or nav list today, and the top bar links notifications, approvals and activity). `docs/engine-api.md` already exists; `docs/integrations.md` is new in Task 2

- [ ] **Step 1:** Update the README and deployment guide. Run `pnpm check:secrets --all`. Expected: PASS.
- [ ] **Step 2:** Run `pnpm verify` (including `e2e`), `FC_NUM_RUNS=5000 pnpm test:engine` and `pnpm predemo --skip-ai`. Expected: all pass.
- [ ] **Step 3:** Rehearse the PRD §23 demo script once more in a production build with `AI_ADAPTER=gemini`. Check each P1 feature once by hand: auto-approve, withdrawal, export, a late cancellation after advancing the demo clock, partial collection, supplier tier editing, price-list import, invoice photo, the impact panel, the log CSV, a webhook delivery to the demo receiver, emergency cancellation, the About page.
- [ ] **Step 4: Commit:** `docs: final release notes for P0 and P1`
- [ ] **Step 5:** Merge to `main` with `--ff-only` and post the final report: **P0 and P1 complete**, with every story by milestone, test results, the reset time, the Gemini model and its scores, and the user's deployment steps from `docs/deployment.md`.
