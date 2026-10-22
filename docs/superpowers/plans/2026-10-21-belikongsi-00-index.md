# BeliKongsi Implementation Plans — Index

> **For agentic workers:** read this index before any milestone plan. Every plan assumes its conventions, interface names and seed values. Each plan is executed with superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Spec:** [`../specs/2026-10-21-belikongsi-prd.md`](../specs/2026-10-21-belikongsi-prd.md) ("PRD") and [`../specs/2026-10-21-belikongsi-build-design.md`](../specs/2026-10-21-belikongsi-build-design.md) ("build design", which wins where they differ). References such as "PRD §6.6", "R7", "C3" and "P1-7" point into those two documents.

---

## 1. Plans and order

Plans run strictly in this order. Each one starts from the code the previous one left on `main`.

| #   | Plan                                                                                                    | Builds                                                            | Planned stop        |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------- |
| M0  | [m00-foundation](2026-10-21-belikongsi-m00-foundation.md)                                               | Repo, tooling, embedded Postgres, Prisma, test harness, CI        | —                   |
| M1  | [m01-kongsi-engine](2026-10-21-belikongsi-m01-kongsi-engine.md)                                         | Pure money engine and the public engine API                       | —                   |
| M2  | [m02-data-model-and-shell](2026-10-21-belikongsi-m02-data-model-and-shell.md)                           | Schema, ledger, log, notifications, approvals, seed, Orbyte shell | D8 visual direction |
| M3  | [m03-catalogue-rounds-usual-list](2026-10-21-belikongsi-m03-catalogue-rounds-usual-list.md)             | Catalogue, rounds, logistics quotes, AI reading, setup            | D7 product images   |
| M4  | [m04-weekly-basket-and-payments](2026-10-21-belikongsi-m04-weekly-basket-and-payments.md)               | Baskets, simulated payments, balance, joining, jobs               | —                   |
| M5  | [m05-round-close-and-outcomes](2026-10-21-belikongsi-m05-round-close-and-outcomes.md)                   | Closing rounds, refunds, outcome notices, events page             | —                   |
| M6  | [m06-ops-approvals-and-supplier-portal](2026-10-21-belikongsi-m06-ops-approvals-and-supplier-portal.md) | Approvals, supplier portal, hub check, money overview             | —                   |
| M7  | [m07-fulfilment](2026-10-21-belikongsi-m07-fulfilment.md)                                               | Consignments, pickups, partner statuses, background shops         | —                   |
| M8  | [m08-delivery-check-and-claims](2026-10-21-belikongsi-m08-delivery-check-and-claims.md)                 | Collecting, delivery checks, photos, claims                       | —                   |
| M9  | [m09-savings-demo-polish](2026-10-21-belikongsi-m09-savings-demo-polish.md)                             | Savings, home, history week, reset, polish                        | —                   |
| M10 | [m10-p0-release](2026-10-21-belikongsi-m10-p0-release.md)                                               | End-to-end test, README, deployment kit                           | —                   |
| M11 | [m11-p1-owner-automation-money](2026-10-21-belikongsi-m11-p1-owner-automation-money.md)                 | P1-1 to P1-6                                                      | —                   |
| M12 | [m12-p1-delivery-exceptions](2026-10-21-belikongsi-m12-p1-delivery-exceptions.md)                       | P1-7 to P1-11                                                     | —                   |
| M13 | [m13-p1-supplier-self-service](2026-10-21-belikongsi-m13-p1-supplier-self-service.md)                   | P1-12, P1-13                                                      | —                   |
| M14 | [m14-p1-ai-photo-impact](2026-10-21-belikongsi-m14-p1-ai-photo-impact.md)                               | P1-14, P1-15                                                      | —                   |
| M15 | [m15-p1-governance-integration](2026-10-21-belikongsi-m15-p1-governance-integration.md)                 | P1-16 to P1-20, final release                                     | —                   |

**How a milestone runs (build design D5):**

1. `git switch -c mNN-<slug>` from `main`.
2. Task 0 (re-sync, §6 below) before any code change.
3. Tasks in order, test-first, one commit per task at least.
4. Final verification: `pnpm verify` (§3) passes.
5. `git switch main && git merge --ff-only mNN-<slug>`.
6. Post the milestone report (§6) and continue to the next plan without waiting. Stop only for a spec change, anything public or irreversible, or a planned stop.

---

## 2. Global constraints (every task in every plan)

| #   | Constraint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | No Docker anywhere: never `supabase start`, `supabase db diff/dump/pull/reset`, `functions serve`, `gen types --local`, Docker-based CI services or Testcontainers. Postgres is `embedded-postgres` 17.10.0-beta.17.                                                                                                                                                                                                                                                                                                               |
| G2  | Versions: Node 24.x; pnpm 10.34.7 (`packageManager`); `next` 16.4.x; `react`/`react-dom` 19.3.x; `typescript` 6.0.x; `prisma`, `@prisma/client`, `@prisma/adapter-pg` exactly 7.10.1; `tailwindcss` 4.3.x; `zod` 4.x; `vitest` 5.x; `fast-check` 4.x; `@playwright/test` 1.64.x; `@google/genai` 2.x; `@supabase/supabase-js` 2.x; `@vis.gl/react-google-maps` 1.x; `simple-git-hooks` 2.x.                                                                                                                                        |
| G3  | Money is integer sen everywhere. JSON fields carrying money end in `Sen`. Rounding is half-up on non-negative values, once per unit amount; a line amount is unit amount × quantity (PRD §6.1). Display format: `RM 1,234.56`.                                                                                                                                                                                                                                                                                                     |
| G4  | Time comes only from the Clock (R5). The database stores UTC (`timestamptz`); the UI shows Malaysia time (UTC+8), e.g. `Thu 5 Nov, 8:00 pm`. Business weeks are ISO weeks computed in Malaysia time.                                                                                                                                                                                                                                                                                                                               |
| G5  | Build design rules R1–R11 hold everywhere: thin route handlers without `next/headers`; no Server Actions; one transaction per state change with its log, postings, notifications and events; money rules only in `src/server/engine`; staff responses without money fields; log entries without names; only `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` reaches the browser; deterministic seed ids; one error shape; due work via `after()`.                                                                                                |
| G6  | Secrets: never commit `API_Key_Configuration.md`, `.env`, `.env.local` or any key. `pnpm check:secrets` runs in the pre-commit hook and in CI; never bypass it (`--no-verify` is forbidden).                                                                                                                                                                                                                                                                                                                                       |
| G7  | Copy: product name **BeliKongsi**; a group order is **a Kongsi** (always capitalised). Exact button labels: "Approve & pay", "Skip this week", "Add to next basket", "Confirm delivery", "All received", "Report a problem", "Why this price?". Plain English on owner and staff screens ("money history", "your goods", "minimum order"). Honesty labels: "Simulated", "AI-generated image", "Estimated", "Made-up data". Every business is fictional and named "… Contoh". Never write "KongsiBeli", "BeliBijak" or "LeakCatch". |
| G8  | Errors are JSON `{ "code": string, "message": string, "details"?: unknown }` with status 400 invalid input, 401 no session, 403 role not allowed, 404 not visible to the caller, 409 state conflict, 422 business rule broken, 429 rate limited, 503 AI unavailable.                                                                                                                                                                                                                                                               |
| G9  | Accessibility (PRD §22): tap targets ≥ 44 px (48 px preferred), body text ≥ 16 px, `tabular-nums` for amounts, WCAG AA contrast, visible focus, a label on every input. Owner and staff screens are designed for 360–430 px and sit in a centred phone-width column on desktop; Ops screens are laptop-first tables.                                                                                                                                                                                                               |
| G10 | Tests: deterministic (fixed clock, fake AI, simulated partners, local storage, no network); money asserted exactly in sen; one behaviour per test, named in plain English; assert outcomes people can see (statuses, amounts, balances, notifications, log entries, permission errors).                                                                                                                                                                                                                                            |

---

## 3. Conventions

**Layout:** build design §4.1. Feature UI components live in `src/components/<feature>/`; page files stay thin.

**Naming:** files kebab-case; React components PascalCase; Prisma models PascalCase mapped to snake_case tables (`@@map`) and snake_case columns (`@map`); enums snake_case values; API JSON camelCase; ISO 8601 UTC strings for times; date-only values `YYYY-MM-DD` in Malaysia time.

**Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`), ending with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**Scripts** (added by the milestone in brackets):

| Script                                                                  | Does                                                                                 |                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| `pnpm dev`                                                              | Next.js dev server on port 3000                                                      | M0                                         |
| `pnpm build` / `pnpm start`                                             | production build / server                                                            | M0                                         |
| `pnpm typecheck`                                                        | `tsc --noEmit`                                                                       | M0                                         |
| `pnpm lint` / `pnpm format` / `pnpm format:check`                       | ESLint / Prettier                                                                    | M0                                         |
| `pnpm check:secrets`                                                    | `tsx scripts/check-secrets.ts --staged` (hook) or `--all` (CI)                       | M0                                         |
| `pnpm test:engine` / `pnpm test:api` / `pnpm test`                      | Vitest projects `engine`, `api`, both                                                | M0                                         |
| `pnpm e2e`                                                              | Playwright                                                                           | M0 (placeholder), M10 (demo)               |
| `pnpm db:dev`                                                           | start the persistent dev Postgres (port 54329)                                       | M0                                         |
| `pnpm db:migrate`                                                       | `prisma migrate dev` against the dev database                                        | M0                                         |
| `pnpm db:setup-role`                                                    | enable `bk_app` login with `BK_APP_DB_PASSWORD`                                      | M0                                         |
| `pnpm db:reset`                                                         | `prisma migrate reset --force`, then `db:setup-role` (and `db:seed` once M2 adds it) | M0 (seed from M2)                          |
| `pnpm db:seed`                                                          | run `seedDemo` against the dev database                                              | M2                                         |
| `pnpm images:generate` / `pnpm images:sheet`                            | product images / contact sheet                                                       | M3                                         |
| `pnpm ai:accuracy`                                                      | AI accuracy run                                                                      | M3                                         |
| `pnpm prod:migrate` / `prod:setup-role` / `prod:storage` / `prod:check` | deployment kit                                                                       | M10                                        |
| `pnpm check:bundle`                                                     | scan the client bundle for server env names, key patterns and server-only packages   | M10                                        |
| `pnpm verify`                                                           | `format:check`, `lint`, `typecheck`, `check:secrets --all`, `test`, `build`          | M0 (`check:bundle` and `e2e` added in M10) |

**Ports:** dev Postgres 54329; test Postgres 54330; end-to-end Postgres 54331; Next.js dev 3000; end-to-end server 3100. (54331 is an addition: the build design does not name a port for the end-to-end database.)

---

## 4. Interface registry

The names below are the contract between plans. A plan that defines one owns its exact signature (in that plan's Interfaces block); later plans use it unchanged.

### 4.1 Engine — `src/server/engine/` (M1)

| Export                                                    | Shape                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Sen`                                                     | `number` (integer)                                                               |
| `Tier`                                                    | `{ minQuantity: number; unitPriceSen: Sen }` — array order is tier position 1..n |
| `UnitAmounts`                                             | `{ goodsSen: Sen; feeSen: Sen; shippingSen: Sen; allInSen: Sen }`                |
| `roundHalfUpDiv(numerator, denominator)`                  | `number`                                                                         |
| `feeSen(goodsSen, feeBps)`                                | `Sen`                                                                            |
| `formatRM(sen)`                                           | `"RM 1,234.56"`; negatives `"-RM 1.85"`                                          |
| `formatUnits(quantity, unitName)`                         | `"1 carton"`, `"6 cartons"`                                                      |
| `validateTiers(tiers, opts?: { buyAlonePriceSen?: Sen })` | `{ ok: true } \| { ok: false; errors: TierError[] }`                             |
| `tierForTotal(tiers, total)`                              | `number \| null` (1-based tier position; `null` below the minimum)               |
| `unitAmounts(goodsSen, feeBps, unitShippingSen)`          | `UnitAmounts`                                                                    |
| `quote(input: QuoteInput)`                                | `QuoteResult`                                                                    |
| `closeRound(input: CloseRoundInput)`                      | `CloseRoundResult`                                                               |
| `allocateShortfall(input: AllocateShortfallInput)`        | `AllocateShortfallResult`                                                        |
| `claimRefund(input: ClaimRefundInput)`                    | `ClaimRefundResult`                                                              |
| `participationSavings(input: SavingsInput)`               | `SavingsResult`                                                                  |
| `explainOutcome(...)`, `explainQuote(...)`                | plain-English sentences (exact copy in M1)                                       |

### 4.2 Platform — `src/server/platform/` (M0, M2)

| Export (file)                                                                                                                                                   | Shape                                  | Milestone                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------ |
| `getServerEnv()` (`env.ts`)                                                                                                                                     | Zod-validated `ServerEnv`, cached      | M0                             |
| `createPrismaClient(url)` (`db.ts`)                                                                                                                             | `PrismaClient` with `PrismaPg` adapter | M0                             |
| `AppDeps`, `getDeps()`, `setDepsForTests(deps \| null)` (`deps.ts`)                                                                                             | dependency container                   | M0 (grows each milestone)      |
| `AppError`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `rateLimited`, `aiUnavailable`, `toErrorResponse` (`errors.ts`) | G8                                     | M0                             |
| `route(options, handler)`, `json(data, init?)` (`http.ts`)                                                                                                      | R1 route wrapper                       | M0 (session/idempotency in M2) |
| `Session`, `loadSession(deps, request)`, `signSessionValue`, `verifySessionValue` (`session.ts`); `getPageSession()` (`session-page.ts`)                        | simulated Orbyte session               | M2                             |
| `Caller`, `personCaller(session)`, `systemCaller(reason)`, `actorOf(caller)` (`caller.ts`)                                                                      | who acts                               | M2                             |
| `requireRole`, `requireShopAccess`, `requireSupplierAccess`, `requireOps` (`permissions.ts`)                                                                    | 403/404 rules                          | M2                             |
| `withTransaction(deps, caller, fn, opts?)`, `TxContext` (`tx.ts`)                                                                                               | R3 transaction with propagation        | M2                             |
| `withIdempotency(deps, scope, key, fn)` (`idempotency.ts`)                                                                                                      | R10                                    | M2                             |
| `enforceRateLimit(deps, bucket, limit, windowMs)` (`rate-limit.ts`)                                                                                             | 429                                    | M2                             |
| `parsePage(query)`, `toPage(rows, limit, cursorOf)` (`pagination.ts`)                                                                                           | cursor lists (PRD §20)                 | M2                             |
| `scheduleDueWork(deps)` (`due-work.ts`)                                                                                                                         | R11 via `after()`                      | M4                             |

### 4.3 Adapters — `src/server/adapters/`

| Export                                                                                                                                                                                                        | Shape                       | Milestone                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------- |
| `Clock`, `MutableClock`, `systemClock`, `fixedClock(iso)`, `withOffset(base, offsetMs)`, `resolveClock(deps)` (`clock.ts`)                                                                                    | time source + demo offset   | M2                              |
| `LatLng`, `distanceKm`, `shippingRatePerKgSen`, `unitShippingSen`, `deliveryFeeSen`, `LogisticsPartner`, `simulatedLogistics` (`logistics.ts`)                                                                | PRD §10 rate card           | M3                              |
| `OrderReader`, `ReadResult`, `ReadLine`, `CatalogueEntry`, `AiUnavailableError` (`ai/types.ts`); `redactPersonalData` (`ai/redact.ts`); `createGeminiOrderReader`, `createFakeOrderReader`, `savedExampleRun` | AI reading                  | M3 (photo M14, price list M13)  |
| `StorageAdapter`, `createLocalStorage(dir, secret)`, `createSupabaseStorage(url, key)` (`storage/*`)                                                                                                          | buckets and signed URLs     | M3 (signed photo URLs M8)       |
| `PaymentsPartner`, `simulatedPayments` (`payments.ts`)                                                                                                                                                        | simulated checkout, payouts | M4 (withdrawals, AutoDebit M11) |

### 4.4 Modules — `src/server/modules/<module>/`

| Module            | Key exports                                                                                                                                                                                                                                                                                        | Milestone                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `activity`        | `ACTIONS`, `appendLog(ctx, entry)`, `verifyLogChain(prisma)`, `queryLog(deps, caller, filter)`, `subjectTimeline(deps, caller, subjectType, subjectId)`                                                                                                                                            | M2 (filters/CSV M15)               |
| `ledger`          | `AccountRef`, `PostingKind`, `post(ctx, posting)`, `balanceOf(db, ref)`, `runMoneyChecks(prisma)`                                                                                                                                                                                                  | M2                                 |
| `notifications`   | `notify(ctx, input)`, `TEMPLATES`, `listNotifications`, `markNotificationRead`, `whatsappShareUrl(text)`                                                                                                                                                                                           | M2 (templates added per milestone) |
| `approvals`       | `createApproval(ctx, input)`, `listPendingApprovals(deps, caller)`, `decideApproval(deps, caller, id, decision)`, `registerApprovalHandler(type, handler)`                                                                                                                                         | M2 (handlers M4, M6, M8, M11)      |
| `integration`     | `emitEvent(ctx, type, data)`, `listEvents(deps, caller)`                                                                                                                                                                                                                                           | M2 (page M5, webhooks M15)         |
| `identity`        | `listSignInAccounts`, `signIn`, `switchMembership`, `sessionView`                                                                                                                                                                                                                                  | M2                                 |
| `directory`       | `getShop`, `listPickupPointsForShop`, `updateShopSettings`                                                                                                                                                                                                                                         | M3                                 |
| `demo`            | `getDemoState`, `resetDemo`, `skipToCutoff`, `completeOtherRounds`                                                                                                                                                                                                                                 | M2, M5, M7, M9                     |
| `catalogue`       | `searchCatalogue`, `getProduct`, `catalogueEntriesForAi`                                                                                                                                                                                                                                           | M3                                 |
| `rounds`          | `cutoffForWeek`, `nextCutoffAfter`, `expectedReadyAt`, `requiredDispatchDate`, `expectedHubDate` (`schedule.ts`); `openDueRounds`, `openNextRound`, `roundProgress`, `listOpenRounds`, `getRoundForCaller`, `quoteForShop`; `closeDueRounds`, `closeRoundById` (M5); `cancelRoundWithRefunds` (M6) | M3, M5, M6                         |
| `usual-list`      | `parseUsualListText`, `getUsualList`, `saveUsualList`                                                                                                                                                                                                                                              | M3                                 |
| `baskets`         | `draftWeeklyBaskets`, `getCurrentBasket`, `addBasketLine`, `changeBasketLine`, `setBasketFulfilment`, `approveBasket`, `skipBasket`, `expireBaskets`, `sendBasketReminders`                                                                                                                        | M4                                 |
| `payments`        | `createPayment`, `simulatePaymentResult`, `getPaymentForCaller`, `getReceipt`, `getBalanceView`, `joinRound`, `cancelParticipation`                                                                                                                                                                | M4                                 |
| `jobs`            | `runDueJobs(deps)`                                                                                                                                                                                                                                                                                 | M4 (extended M5, M11, M12, M15)    |
| `supplier-orders` | `draftSupplierOrder` (M5); `approveSupplierOrder`, `rejectSupplierOrder`, `confirmSupplierOrder`, `rejectSupplierOrderBySupplier`, `markDispatched`, `previewHubCheck`, `recordHubCheck` (M6)                                                                                                      | M5, M6                             |
| `fulfilment`      | `planConsignmentsAndPickups`, `updateConsignmentStatus`, `refreshPickupReadiness`, `collectPickup`, `listShopPickups`, `listConsignments`                                                                                                                                                          | M7                                 |
| `checks`          | `requestPhotoUpload`, `submitDeliveryCheck`, `getClaimForCaller`, claim approval handler                                                                                                                                                                                                           | M8                                 |
| `savings`         | `participationSavingsView`, `monthlySavings`, `homeSummary`                                                                                                                                                                                                                                        | M9                                 |
| `ops`             | `opsRoundsBoard`, `opsRoundDetail`, `moneyOverview`                                                                                                                                                                                                                                                | M6 (impact panel M14)              |

### 4.5 Test helpers — `tests/api/helpers/` (M0, M2)

| Export                                                                           | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTestDatabase()`                                                           | `{ adminUrl: string; appUrl: string; drop(): Promise<void> }` — a fresh copy of the migrated template (M0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `callRoute(method, path, init?)`                                                 | resolves `src/app/api/**/route.ts` from the URL path (dynamic `[param]` folders supported) and calls the handler with a real `Request` (M0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `createTestApp(opts?: { now?: string; seed?: 'none' \| 'reference' \| 'demo' })` | `TestApp` (M2). `'reference'` runs `seedReferenceData` only; `'demo'` (the default) runs the full `seedDemo`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `TestApp`                                                                        | `{ deps: AppDeps; prisma: PrismaClient; clock: MutableClock; as(user: SeedUserKey): Promise<Client>; anonymous(): Client; adminQuery(sql: string, params?: unknown[]): Promise<unknown[]>; close(): Promise<void> }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Client`                                                                         | `get/post/put/patch/delete(path, body?, headers?)` → `{ status: number; body: any; headers: Headers }`; `switchTo(membershipId)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `expectNoMoneyFields(value)`                                                     | deep scan for keys matching `/sen\|price\|amount\|total\|balance\|saving\|fee/i` (R6) (M2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `expectNoShopIdentity(value, shopNames, shopIds)`                                | deep scan for shop ids or names (supplier views) (M6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Scenario and query helpers in `tests/api/helpers/scenarios.ts`                   | **Flows:** `setupKedaiKopi`, `payBasket` (M4), `toFormed` (M6), `toHubChecked` (M7). **Lookups by seed key:** `participationOf(shopKey, productKey)`, `basketOf(shopKey, week)`, `basketIdOf`, `feeChargeOf(shopKey, date)`, `totalsByProductKey(app)`, `roundOf(productKey, week)`, `openRoundOf(productKey)`, `order(id)`, `round(id)`, `supplierOrderOf(roundId)`, `consignmentFor({ hub, destinationKey, deliveryDate })`, `pickupOf(shopKey, date)`, `allocationOf(shopKey, productKey)`, `moveConsignment(id, status)`. **Notifications:** `lastWhatsapp(userKey, type, contains?)`, `countWhatsapp(userKey, type)`. Each helper is added by the first milestone that uses it, with exactly these names. |

**Seed id kinds and keys** (for `seedId(kind, key)`): `hub` (`HUB_KV`, `HUB_JOHOR`), `pickup_point` (`PP_IPOH` …), `supplier` (`SUP_DRY`, `SUP_EGG`, `SUP_PACK`), `product` (`CM` … `KRAFT`), `price_tier` (`<product key>:<position>`), `shop` (`KEDAI_KOPI`, `GERAI`, `KAFE`, `BG01` … `BG40`), `user` and `membership` (the user keys from index §5.3 and §5.5; each seeded user has exactly one membership), `operator` (`OPS`), `usual_list` and `usual_list_item` (`<shop key>` and `<shop key>:<product key>`).

---

## 5. Seed scenario

Shared by every milestone that seeds or asserts demo numbers. All businesses, people and products are fictional (PRD §23).

### 5.1 Anchor and time line

- Tests anchor the demo week at **Monday 2 Nov 2026, 06:05 MYT = `2026-11-01T22:05:00Z`** (ISO week `2026-W45`). "Reset demo data" uses the most recent Monday 06:05 MYT instead (PRD §7); every seed time below is relative to the anchor Monday.
- Current week (built in M4): weekly rounds opened at Thu 29 Oct 20:00 MYT; packaging rounds opened at the same time with the fortnightly anchor week set to the demo week (O5); background shops joined Fri 30 Oct – Sun 1 Nov; baskets drafted Mon 06:00; Gerai Contoh paid at 06:01, Kafe Contoh at 06:03; clock left at 06:05.
- History week (added in M9, run before the current week): W44 weekly rounds opened Thu 22 Oct 20:00 and closed Thu 29 Oct 20:00; Ops approval Fri 30 Oct 09:00; supplier confirmation 11:00; dispatch 15:00; hub check Sat 31 Oct 10:00 (all good); consignments dispatched 14:00; arrived or delivered Sun 1 Nov 10:00; Gerai and Kafe goods collected 12:00 and checked "All received" 12:05 by their staff. Packaging rounds then open from Thu 22 Oct.
- Demo-week dates: cut-off **Thu 5 Nov 20:00 MYT** (`2026-11-05T12:00:00Z`); expected ready **Tue 10 Nov 10:00 MYT** (`2026-11-10T02:00:00Z`), delivery date `2026-11-10`; required dispatch date `2026-11-07`; expected hub date `2026-11-09`; next weekly cut-off Thu 12 Nov.

### 5.2 Network (great-circle distances are verified by M3 tests)

| Key           | Name                                    | Lat    | Lng      |
| ------------- | --------------------------------------- | ------ | -------- |
| `HUB_KV`      | Klang Valley hub (Shah Alam, Selangor)  | 3.0738 | 101.5183 |
| `HUB_JOHOR`   | Johor hub (Senai, Johor)                | 1.6006 | 103.6419 |
| `PP_IPOH`     | Ipoh pickup point (Perak)               | 4.5975 | 101.0901 |
| `PP_JB`       | Johor Bahru pickup point (Johor)        | 1.4927 | 103.7414 |
| `PP_KUANTAN`  | Kuantan pickup point (Pahang)           | 3.8077 | 103.3260 |
| `PP_PJ`       | Petaling Jaya pickup point (Selangor)   | 3.1073 | 101.6067 |
| `PP_SEREMBAN` | Seremban pickup point (Negeri Sembilan) | 2.7258 | 101.9424 |
| `PP_MELAKA`   | Melaka pickup point (Melaka)            | 2.1896 | 102.2501 |

All pickup points are open "10 am–7 pm daily". Required results: `HUB_KV`→`PP_IPOH` in the 60–200 km band; `HUB_KV`→`PP_JB` and `HUB_KV`→`PP_KUANTAN` in 200–400 km; `HUB_JOHOR`→`PP_KUANTAN` in 200–400 km.

### 5.3 Suppliers, users and the operator

| Key        | Supplier                      | Hub         | Order-desk user (key) |
| ---------- | ----------------------------- | ----------- | --------------------- |
| `SUP_DRY`  | Pembekal Barang Kering Contoh | `HUB_KV`    | Farid (`farid`)       |
| `SUP_EGG`  | Ladang Telur Contoh           | `HUB_JOHOR` | Lim (`lim`)           |
| `SUP_PACK` | Pembungkusan Contoh           | `HUB_KV`    | Priya (`priya`)       |

Operator: "BeliKongsi Operations"; Ops user Nadia (`nadia`).

### 5.4 Catalogue (PRD §23; prices in sen; tiers as `min:price`)

| Key      | Supplier   | Name / shortName                                 | Pack                           | Unit   | Grams | Buy-alone | Tier 1   | Tier 2   | Tier 3    | Cadence     | Aliases (beyond the name)                | Pack conversion    |
| -------- | ---------- | ------------------------------------------------ | ------------------------------ | ------ | ----- | --------- | -------- | -------- | --------- | ----------- | ---------------------------------------- | ------------------ |
| `CM`     | `SUP_DRY`  | Sweetened condensed milk 390 g / condensed milk  | carton of 48 × 390 g tins      | carton | 19500 | 16800     | 20:15800 | 50:15200 | 100:14600 | weekly      | susu pekat, 炼奶, SKM, susu pekat manis  | 48 tin = 1 carton  |
| `EM`     | `SUP_DRY`  | Evaporated milk 390 g / evaporated milk          | carton of 48 × 390 g tins      | carton | 19500 | 15000     | 20:14100 | 50:13600 | 100:13100 | weekly      | susu cair, 淡奶, evap                    | 48 tin = 1 carton  |
| `OIL`    | `SUP_DRY`  | Cooking oil (palm olein) 17 kg / cooking oil     | 17 kg tin                      | tin    | 18000 | 11500     | 20:10800 | 50:10400 | 100:10000 | weekly      | minyak, minyak masak, 油, palm oil       | —                  |
| `FLOUR`  | `SUP_DRY`  | Wheat flour 25 kg / flour                        | 25 kg sack                     | sack   | 25000 | 6800      | 20:6300  | 50:6050  | 100:5800  | weekly      | tepung, 面粉, tepung gandum              | —                  |
| `COFFEE` | `SUP_DRY`  | Coffee powder 1 kg / coffee powder               | carton of 10 × 1 kg packs      | carton | 10500 | 26000     | 10:24500 | 25:23600 | 50:22800  | weekly      | kopi, 咖啡粉, serbuk kopi                | 10 pack = 1 carton |
| `TEA`    | `SUP_DRY`  | Black tea dust 1 kg / tea dust                   | carton of 10 × 1 kg packs      | carton | 10500 | 18000     | 10:17000 | 25:16400 | 50:15800  | weekly      | teh, 茶, serbuk teh                      | 10 pack = 1 carton |
| `EGG_A`  | `SUP_EGG`  | Grade A eggs / Grade A eggs                      | tray of 30 eggs                | tray   | 1900  | 1320      | 100:1230 | 300:1190 | 600:1150  | weekly      | telur A, 鸡蛋 A, gred A, telur gred A    | —                  |
| `EGG_B`  | `SUP_EGG`  | Grade B eggs / Grade B eggs                      | tray of 30 eggs                | tray   | 1800  | 1260      | 100:1170 | 300:1130 | 600:1090  | weekly      | telur B, 鸡蛋 B, gred B, telur gred B    | —                  |
| `CUPS`   | `SUP_PACK` | 16 oz plastic cups with lids / 16 oz cups        | carton of 1,000 cups with lids | carton | 9000  | 13500     | 10:12400 | 25:11800 | 50:11200  | fortnightly | cawan 16oz, 16oz cups, 杯, cawan plastik | —                  |
| `CONT`   | `SUP_PACK` | 650 ml takeaway containers / takeaway containers | carton of 500 containers       | carton | 11000 | 9800      | 10:9000  | 25:8600  | 50:8200   | fortnightly | bekas tapau, 饭盒, container 650ml       | —                  |
| `BAGS`   | `SUP_PACK` | Plastic carrier bags (medium) / carrier bags     | carton of 50 packs             | carton | 10000 | 8500      | 10:7800  | 25:7400  | 50:7000   | fortnightly | beg plastik, 塑料袋                      | —                  |
| `KRAFT`  | `SUP_PACK` | Kraft paper bags / paper bags                    | carton of 1,000 bags           | carton | 12000 | 12000     | 10:11000 | 25:10500 | 50:10000  | fortnightly | beg kertas, 纸袋, kraft bag              | —                  |

Categories: `CM`, `EM` dairy; `OIL` oil; `FLOUR` flour; `COFFEE`, `TEA` beverages; `EGG_A`, `EGG_B` eggs; the rest packaging. Fee: 200 basis points. Cut-off: Thursday 20:00 MYT for every product.

### 5.5 Demo shops and users

| Key          | Shop              | Type, place                      | Coordinates                                          | Fulfilment             | Owner (key, provider)         | Staff (key)       |
| ------------ | ----------------- | -------------------------------- | ---------------------------------------------------- | ---------------------- | ----------------------------- | ----------------- |
| `KEDAI_KOPI` | Kedai Kopi Contoh | kopitiam, Ipoh, Perak 30000      | 4.6005, 101.0790                                     | pickup at `PP_IPOH`    | Ah Seng (`ahSeng`, Microsoft) | Rahim (`rahim`)   |
| `GERAI`      | Gerai Contoh      | hawker, Johor Bahru, Johor 80000 | 1.5407, 103.7664 (≈ 6 km from `PP_JB`, fee RM 12.00) | door                   | Siti (`siti`, Google)         | Kumar (`kumar`)   |
| `KAFE`       | Kafe Contoh       | café, Kuantan, Pahang 25000      | 3.8160, 103.3270                                     | pickup at `PP_KUANTAN` | Mei (`mei`, Google)           | Danial (`danial`) |

Usual lists (sen): Gerai — `CM` 4 @ 16800, `EM` 2 @ 15000, `FLOUR` 2 @ 7200, `CONT` 3 @ 9800. Kafe — `CM` 3 @ 16700, `EGG_B` 10 @ 1220 (limit 1220), `COFFEE` 2 @ 25800, `CUPS` 3 @ 13200. Kedai Kopi — none at reset (the demo starts with setup). Price limits default to the usual price.

### 5.6 Sample order (C14)

Fixture `prisma/seed/sample-order.ts`, shared by the fake AI adapter, "Try with sample data" and the end-to-end test:

```
Hi boss, minggu ni order macam biasa ya 🙏
炼奶 6箱
minyak masak 2 tin
telur 10 papan
kopi 1 ctn
cawan 16oz 2 ctn
Terima kasih! Kalau ada masalah call 012-345 6789
```

Expected reading: `CM` 6 (0.97), `OIL` 2 (0.95), eggs 10 trays → `EGG_A` with alternative `EGG_B` (0.55, "Please check"), `COFFEE` 1 (0.93), `CUPS` 2 (0.96); the greeting and the sign-off are ignored text; the phone number is redacted before the AI call. Sample usual prices (sen): `CM` 16500, `OIL` 11800, `EGG_A` 1380, `EGG_B` 1320, `COFFEE` 26200, `CUPS` 13500. In the demo, Rahim then adds 1 carton of `EM` (not on the usual list).

### 5.7 Background shops and designed totals

- 40 background shops `BG01`…`BG40`: types cycle kopitiam, hawker, café, restaurant, bakery; names "Kopitiam Contoh NN", "Warung Contoh NN", "Kafe Kecil Contoh NN", "Restoran Contoh NN", "Bakeri Contoh NN"; regions cycle `PP_IPOH`, `PP_JB`, `PP_KUANTAN`, `PP_PJ`, `PP_SEREMBAN`, `PP_MELAKA`; coordinates = pickup point + (0.01 × (NN mod 4), 0.01 × (NN mod 3)) degrees; every fifth shop (05, 10, …) uses door delivery; no price limits; no users (`isBackground = true`).
- Background quantities per current-week round (each list in join order):

| Round    | Background quantities                                  | Background total | With Gerai + Kafe at reset |
| -------- | ------------------------------------------------------ | ---------------- | -------------------------- |
| `CM`     | 20, 18, 16, 14, 12, 12                                 | 92               | 99 (+4 Gerai, +3 Kafe)     |
| `EM`     | 10, 9, 8, 7, 6, 6, 5, 4                                | 55               | 57                         |
| `OIL`    | 14, 12, 11, 10, 10, 9, 9, 8, 7, 6, 4, 4                | 104              | 104                        |
| `FLOUR`  | 8, 6, 5, 4                                             | 23               | 25                         |
| `COFFEE` | 7, 6, 5, 4, 3, 2                                       | 27               | 29                         |
| `TEA`    | 4, 2                                                   | 6                | 6 (fails: minimum 10)      |
| `EGG_A`  | 40, 35, 30, 28, 26, 25, 24, 22, 20, 18, 16, 14, 12, 10 | 320              | 320                        |
| `EGG_B`  | 20, 18, 15, 14, 12, 11, 10, 8, 7, 5                    | 120              | 130 (+10 Kafe)             |
| `CUPS`   | 6, 5, 5, 4, 3, 3                                       | 26               | 29                         |
| `CONT`   | 4, 3, 3, 2                                             | 12               | 15                         |
| `BAGS`   | 9, 8, 7, 6, 6, 5, 4, 3, 3                              | 51               | 51                         |
| `KRAFT`  | —                                                      | 0                | 0 (closes empty, silently) |

- Assignment: walk the rounds in the table's order and their quantities in order; give the k-th quantity overall (k = 0, 1, …, 80) to `BG` number `(k mod 40) + 1`. Every background shop gets 2 or 3 rounds and never two lines in one round. Join times are spread evenly from Fri 30 Oct 09:00 to Sun 1 Nov 21:00 MYT in the same k order.
- Demo outcome after Kedai Kopi pays (6 `CM`, 2 `OIL`, 10 `EGG_A`, 1 `COFFEE`, 2 `CUPS`) and Rahim adds 1 `EM`: `CM` 105 cartons from 9 shops (tier 3), Kafe's `EGG_B` line dropped at cut-off (130 → 120, tier 1), `TEA` fails, `KRAFT` closes empty, every other round forms.
- Featured round (demo settings): the current `CM` round.

### 5.8 Key amounts (C15 and PRD §6.13)

| Amount                                                               | Sen           |
| -------------------------------------------------------------------- | ------------- |
| `CM` starting all-in, Ipoh (15800 + 316 + 293)                       | 16409         |
| Kedai Kopi `CM` line, 6 cartons                                      | 98454         |
| `CM` final all-in at tier 3, Ipoh (14600 + 292 + 293)                | 15185         |
| `CM` starting / final all-in, Johor Bahru and Kuantan (shipping 429) | 16545 / 15321 |
| Kedai Kopi `CM` refund at cut-off (6 × 1224)                         | 7344          |
| Kafe `EGG_B` starting all-in (1170 + 23 + 40); limit                 | 1233; 1220    |
| Kafe `EGG_B` full refund (10 × 1233)                                 | 12330         |
| Lowest tier meeting 1220 for Kafe: tier 2 (1130 + 23 + 40)           | 1193          |
| `CM` supplier order (105 × 14600)                                    | 1533000       |
| Claim refund, 1 damaged `CM` carton (Ipoh)                           | 15185         |
| Kedai Kopi verified `CM` savings ((16500 − 15185) × 5)               | 6575          |
| Gerai door delivery fee                                              | 1200          |

---

## 6. Task 0 (every plan) and the milestone report

**Task 0: Re-sync** is the first task of every plan. Its steps:

1. Create the branch named in the plan.
2. Read the plan, this index, and the spec sections the plan cites.
3. For every name in the plan's Interfaces blocks marked "Consumes", open the defining file and confirm the exact name, parameters and return type. If anything differs, edit the plan (not the code) so it uses what exists, and note each change.
4. Run the commands the plan relies on (`pnpm verify`, plus anything listed in the plan's Task 0) and confirm they pass on the branch's starting point.
5. If a library behaves differently from the plan (for example a changed API in a pinned version), check its documentation and adjust the plan's steps; never change the spec's behaviour to fit.
6. Commit the plan edits, if any: `docs(plan): re-sync mNN with the code as built`.

**Milestone report** (posted to the user at the end of each milestone, without waiting for a reply): what was built (stories, by number), the commands run and their results, plan changes made in Task 0, any deviation from the spec, and what the next milestone starts with.
