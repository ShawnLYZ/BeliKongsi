# BeliKongsi

Beli sama-sama, harga borong · Buy together, pay wholesale

**Status:** P0 and P1 complete. The whole demo journey works from sign-in to verified savings, and the P1 extras listed under "P1 features" are built.

> **Everything here is made up.** Every business, person and product is fictional, and each business is named "... Contoh". Payments, payouts, logistics, sign-in and WhatsApp are **simulated**: no real money moves and no real message is sent. Demo mode shows a "Made-up data" banner.

## The problem

A small kopitiam, hawker stall or cafe restocks the same things every week: condensed milk, cooking oil, eggs, coffee, cups and boxes. Each shop orders a few cartons at a time, so it never reaches a supplier's minimum order or its cheaper carton price. It pays the "buy-alone" price, while big chains pay less for the same tin.

Shops could buy together, but organising it is busywork. Someone has to collect quantities on WhatsApp, add them up, bargain, split the delivery, collect the money and chase late payers, every week. So it rarely happens, and when it does the count goes wrong and people argue. Nearby shops are also often competitors, so they do not want each other to see what they buy or pay.

## The solution

BeliKongsi turns weekly restocking into one tap. Each product from each supplier runs a standing group order, **a Kongsi**, on a weekly or fortnightly cycle.

- An owner saves a **usual list** once, by pasting an old WhatsApp order that AI reads.
- Every Monday the usual list becomes a ready-to-pay **weekly basket**. Staff can add items. The owner approves and pays in one action ("Approve & pay").
- BeliKongsi is the buyer. It collects the payments, places one consolidated order with the supplier at the price tier the combined quantity reaches, and receives the goods at a regional hub. A logistics partner then brings each shop's goods to its pickup point or its door.
- Everyone in a Kongsi pays the same final price. Anything paid above it comes back automatically to the shop's BeliKongsi balance.
- Every unit paid for is either delivered or refunded, and every step is written to a tamper-evident activity log.
- Shops stay anonymous to each other and to suppliers.

AI only reads messy text into a draft that a person confirms. Prices, refunds and approvals follow fixed rules (the Kongsi Engine).

## P1 features

What P1 added on top of the P0 journey, by milestone:

- **M11, owner automation and money.** Auto-approve for routine weeks under a rule the owner controls, withdrawing the BeliKongsi balance, a monthly summary with an estimate of time saved, a data export (ZIP) and a clean shop deletion.
- **M12, delivery exceptions.** Delay notices and a full-refund cancel of a late item after 3 days, partial collection of goods that arrive in parts, reminders for uncollected goods and unchecked deliveries, and chasers for suppliers and Ops.
- **M13, supplier self-service.** Suppliers create and edit products, price tiers, buy-alone prices, schedules and photos (changes apply from the next round), and import a price list by pasting or photographing it, with AI drafting a table the supplier confirms.
- **M14, AI photo and impact.** Owners build the usual list from a photo of an old invoice (the photo is never stored), and Ops get an impact panel: time to approve, approval rate, AI acceptance, claim rate and supplier reliability.
- **M15, governance and integration.**
  - Ops filter the activity log by date, person, action and subject, and export it as CSV. Each row carries the hash of the stored entry. A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'` so spreadsheets don't run it as a formula, so remove that `'` before checking a row against the hash chain.
  - Ops cancel an open round in an emergency, with automatic refunds.
  - Delivery photos are deleted after 90 days.
  - Signed webhooks for other Orbyte apps, with retries and an SSRF guard, a demo receiver and an Ops events page. See [docs/integrations.md](docs/integrations.md).
  - An [About page](#the-about-page) for judges.

### The About page

`/about` explains what BeliKongsi is and what is simulated. It is linked from the footer of the signed-in screens and from the sign-in page.

## The five-step journey

How BeliKongsi covers the brief's five steps:

| Brief step                 | In BeliKongsi                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Trigger                 | Every Monday at 06:00 (Malaysia time) a weekly basket is drafted from each shop's usual list. Owners can also join any open Kongsi by hand.                                                            |
| 2. Connected data          | The usual list (items, quantities, usual prices, price limits), the supplier's price tiers, live Kongsi totals, shipping and delivery quotes from the logistics partner, and the shop's balance.       |
| 3. Decision logic          | The Kongsi Engine applies fixed rules: which price tier was reached, each shop's all-in price, price-limit dropouts, refunds and short-delivery allocation. AI makes no decisions.                     |
| 4. Human approval          | The owner approves and pays the basket. BeliKongsi Ops approves the consolidated supplier order. The supplier confirms it. Ops decides claims.                                                         |
| 5. Visible outcome and log | The final price and refunds are shown and notified, the order is placed, a pickup code is issued, the delivery is checked and verified savings appear. Every step is in the hash-chained activity log. |

## Architecture overview

BeliKongsi is one Next.js (App Router) application in TypeScript. It has role-specific, phone-first pages, JSON API routes, a server-only service layer and protected endpoints for scheduled jobs. Data lives in Postgres (Supabase in production), reached only from the server through Prisma.

```
 Browser (owner, staff, supplier and Ops screens)
        |
        v
 Pages and API routes          src/app, src/app/api
   read the simulated session, check the role, validate input,
   shape each response for the caller's role, one error format
        |
        v
 Application services          src/server/modules/*
   catalogue, rounds, usual-list, baskets, payments, ledger,
   supplier-orders, fulfilment, checks, savings, approvals,
   notifications, activity, identity, integration, demo, jobs
        |                               |
        v                               v
 Kongsi Engine (pure)          Adapters           src/server/adapters
   src/server/engine             clock, payments, logistics,
   no database, network          AI reader (Gemini, fake, saved example),
   or clock                      storage (Supabase or local)
        |                               |
        +---------------+---------------+
                        v
 Persistence               Prisma + Postgres, Storage
```

- **Modules.** Each module under `src/server/modules` owns one job (for example rounds, baskets, ledger or supplier orders). Route handlers stay thin and call a module.
- **The engine.** All money rules live in `src/server/engine`: tier prices, the BeliKongsi fee, shipping share, price-limit dropouts, refunds, short-delivery allocation and savings. It is pure, so the same input always gives the same answer. It is also offered as a public API (see below).
- **Adapters.** Outside services sit behind replaceable adapters: the clock (system time plus a demo offset), the simulated payments and logistics partners, the AI reader and file storage. Tests use fixed or fake versions.
- **One transaction per change.** Each state change runs in one database transaction that also writes its ledger postings, activity log entries, notifications and integration events, so they cannot disagree.
- **Where security lives.**
  - Sessions are signed with `SESSION_SECRET`. Every API route declares who may call it, and role checks run on the server (`src/server/platform/permissions.ts`).
  - Input is validated at the API boundary. Staff responses never include money fields, and log entries carry no names.
  - The database is reached only by the server, through a limited `bk_app` login, with row-level security enabled in the migrations. The browser has no direct database access.
  - Job endpoints need `CRON_SECRET`. Secrets are never committed: `pnpm check:secrets` runs in the pre-commit hook and in CI, and `pnpm check:bundle` scans the browser bundle for server-only names.
  - The only value that reaches the browser is the restricted Google Maps key.
- **Money and time.** All money is whole sen, shown as `RM 1,234.56`. Business time comes only from the Clock.

## Run it locally

You need Node 24 and pnpm 10. No Docker is needed: the local database is an embedded Postgres.

1. Install packages: `pnpm install`
2. Copy `.env.example` to `.env.local`, then generate real values for `SESSION_SECRET` and `CRON_SECRET`:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. Start the dev Postgres (port 54329): `pnpm db:dev`. It keeps running in the foreground, so leave that terminal open and use a second terminal for the next steps.
4. Create the schema, enable the `bk_app` login and load the demo data: `pnpm db:reset`
5. Start the app on port 3000: `pnpm dev`

The Supabase, Gemini and Maps `<placeholder>` values can stay as they are for local development (`AI_ADAPTER=fake`, `STORAGE_ADAPTER=local`).

### Environment variables

Names only. Real values go in `.env.local` (never committed) or in the hosting dashboard.

| Name                              | Used for                                                        |
| --------------------------------- | --------------------------------------------------------------- |
| `MIGRATION_DATABASE_URL`          | database connection used for migrations                         |
| `DATABASE_URL`                    | database connection used by the app                             |
| `BK_APP_DB_PASSWORD`              | password for the limited `bk_app` database login                |
| `SUPABASE_URL`                    | Supabase project URL (production only)                          |
| `SUPABASE_SERVICE_ROLE_KEY`       | Supabase server key for Storage (production only)               |
| `SUPABASE_ACCESS_TOKEN`           | Supabase CLI and Management API, per command only, never stored |
| `GEMINI_API_KEY`                  | Gemini, which reads pasted orders                               |
| `GEMINI_MODEL`                    | which Gemini model to use                                       |
| `AI_ADAPTER`                      | `gemini` or `fake`                                              |
| `NVIDIA_API_KEY`                  | product image generation, on the maker's machine only           |
| `STORAGE_ADAPTER`                 | `supabase` or `local`                                           |
| `LOCAL_STORAGE_DIR`               | folder for local storage                                        |
| `SESSION_SECRET`                  | signs the simulated sign-in session                             |
| `CRON_SECRET`                     | protects the scheduled-job endpoint                             |
| `DEMO_MODE`                       | turns on the demo controls and banner                           |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | restricted Google Maps key, the only value sent to the browser  |

### Seed and reset

`pnpm db:reset` rebuilds the local database and loads the demo data. `pnpm db:seed` re-runs only the seed. In the running app, demo mode has a "Reset demo data" button that puts the shared demo back to its start: the clock is set to the most recent Monday 06:05 (Malaysia time), and the shops, Kongsis and a completed previous week are recreated.

### Scripts

| Script                                                                  | Does                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                                                              | Next.js dev server on port 3000                                              |
| `pnpm build` / `pnpm start`                                             | production build / server                                                    |
| `pnpm typecheck`                                                        | `tsc --noEmit`                                                               |
| `pnpm lint` / `pnpm format` / `pnpm format:check`                       | ESLint / Prettier                                                            |
| `pnpm check:secrets`                                                    | `tsx scripts/check-secrets.ts --staged` (hook) or `--all` (CI)               |
| `pnpm test:engine` / `pnpm test:api` / `pnpm test`                      | Vitest projects `engine`, `api`, both                                        |
| `pnpm e2e` / `pnpm e2e:server`                                          | Playwright demo test / the isolated server it uses                           |
| `pnpm db:dev`                                                           | start the persistent dev Postgres (port 54329)                               |
| `pnpm db:migrate`                                                       | `prisma migrate dev` against the dev database                                |
| `pnpm db:setup-role`                                                    | enable `bk_app` login with `BK_APP_DB_PASSWORD`                              |
| `pnpm db:reset`                                                         | reset the schema, enable the `bk_app` login, then seed                       |
| `pnpm db:seed`                                                          | run `seedDemo` against the dev database                                      |
| `pnpm images:generate` / `pnpm images:sheet`                            | product images / contact sheet                                               |
| `pnpm ai:accuracy`                                                      | AI accuracy run (live, needs `GEMINI_API_KEY`)                               |
| `pnpm prod:migrate` / `prod:setup-role` / `prod:storage` / `prod:check` | deployment kit                                                               |
| `pnpm check:bundle`                                                     | scan the client bundle for server env names, key patterns and packages       |
| `pnpm verify`                                                           | format check, lint, typecheck, secrets scan, tests, build, bundle check, e2e |

`pnpm verify` ends with the end-to-end test, so it needs Chromium (`pnpm exec playwright install chromium`) and free ports 3100 and 54331. It always starts its own server on port 3100, never reusing one that is already running.

## The demo script (about 4 minutes)

Demo mode shows a role switcher and the presenter controls "Skip to cut-off", "Complete other rounds" and "Reset demo data". Start from a fresh reset.

1. **Owner, Kedai Kopi Contoh.** Sign in (simulated Microsoft). Set up:
   - Paste the sample order. AI suggestions appear, with one highlighted match to confirm.
   - Usual prices are pre-filled from the sample (condensed milk RM 165.00).
   - Pick the Ipoh pickup point on the map. Done.
   - The basket appears. Optional: switch to staff (Rahim) and add 1 carton of evaporated milk, which the owner sees highlighted.
2. **Owner.** Open "Why this price?" on condensed milk: "99 cartons so far, 1 more for RM 146.00". "Approve & pay" with simulated DuitNow QR, then view the receipt. The Kongsi now has 105 cartons and tier 3 is reached.
3. **Presenter.** "Skip to cut-off".
   - Owner notification: RM 73.44 refunded on condensed milk.
   - Switch to Kafe Contoh's owner: Grade B eggs dropped (limit RM 12.20 against RM 12.33), RM 123.30 refunded.
4. **Ops.** Approvals inbox, then the condensed milk order (105 cartons, RM 15,330.00, 9 shops, money check passed) and approve it.
   - Switch to the supplier: confirm with a dispatch date, then mark dispatched.
   - Back to Ops: hub check (105 good), allocation preview, confirm (simulated payout).
   - Presenter: "Complete other rounds".
   - Ops: mark the Ipoh consignments dispatched, then arrived.
5. **Staff, Kedai Kopi Contoh.** "Confirm delivery": show the code, then Collected. Condensed milk: 1 damaged, with a photo. Everything else received. Submit.
6. **Ops.** Claim review, approve. RM 151.85 refunded.
7. **Owner.** Home shows verified savings, balance and the condensed milk timeline. In Ops, "Verify log" and the money overview both show a tick.

If the AI is unavailable during step 1, use "Use saved example".

## The Kongsi Engine API

The pricing and settlement maths is offered as a public, stateless HTTP API. It needs no sign-in, stores nothing and gives the same answer for the same body. All amounts are whole sen.

| Endpoint                                 | Purpose                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| `POST /api/engine/v1/quote`              | What a buyer pays now, and what they pay if the Kongsi fills |
| `POST /api/engine/v1/close-round`        | Settle a Kongsi at cut-off: final tier, who is kept, refunds |
| `POST /api/engine/v1/allocate-shortfall` | Share out good units when fewer arrive than were ordered     |

Quick try (local app on port 3000):

```
curl -X POST http://localhost:3000/api/engine/v1/quote \
  -H "Content-Type: application/json" \
  -d '{"tiers":[{"minQuantity":20,"unitPriceSen":15800},{"minQuantity":50,"unitPriceSen":15200},{"minQuantity":100,"unitPriceSen":14600}],"feeBps":200,"unitShippingSen":293,"quantity":6,"currentRoundTotal":99,"unitName":"carton"}'
```

Full request and response examples, limits and the error format are in [docs/engine-api.md](docs/engine-api.md). Webhooks for other Orbyte apps are described in [docs/integrations.md](docs/integrations.md).

## Run the tests

| Command                   | What it does                                                |
| ------------------------- | ----------------------------------------------------------- |
| `pnpm test`               | all Vitest tests (engine and API)                           |
| `pnpm test:engine`        | the pure engine tests, including property-based tests       |
| `pnpm test:api`           | API and service tests against an embedded Postgres          |
| `pnpm e2e`                | the demo script in a real browser at phone size (390 x 844) |
| `BASE_URL=<url> pnpm e2e` | the same test against a deployed app, using the real AI     |

- Tests are deterministic: a fixed clock, a fake AI, simulated partners, local storage and no network.
- `FC_NUM_RUNS` sets how many random cases each property-based engine test tries (default 1000). CI uses 5000, for example `FC_NUM_RUNS=5000 pnpm test:engine`.
- `pnpm e2e` starts its own isolated database (port 54331) and a production build (port 3100), so it never touches your dev data. Run `pnpm exec playwright install chromium` once first.

## AI accuracy results

Twenty fictional WhatsApp orders were read by Gemini through the real adapter and prompt. An order counts as correct only when every expected line matches by product and quantity and no extra product is matched. Full tables are in [docs/ai-accuracy.md](docs/ai-accuracy.md).

| Model                        | Correct | Invented products | Errors | Chosen |
| ---------------------------- | ------- | ----------------- | ------ | ------ |
| gemini-3.5-flash-lite        | 19/20   | 0                 | 0      | yes    |
| gemini-3.1-flash-lite, run 1 | 14/20   | 0                 | 5      | no     |
| gemini-3.1-flash-lite, rerun | 17/20   | 0                 | 2      | no     |

The bar was at least 18/20 with no invented products. The one miss for the chosen model read "teh 20 pek" and "kopi 30 pek" as 20 and 30 cartons instead of converting packs. Owners always confirm quantities on a review screen before anything is saved.

## Deployment

See [docs/deployment.md](docs/deployment.md).

## Before every demo

Run `pnpm predemo --url https://<your-app>.vercel.app`. It runs `pnpm audit --prod`, then `pnpm ai:accuracy` (it needs `GEMINI_API_KEY`; add `--skip-ai` to leave it out), then `pnpm e2e` against the URL, and stops at the first failing step. Without `--url` the deployed end-to-end test is skipped. It ends by listing the checks only a person can do, in the deployed app:

1. Press "Reset demo data".
2. "Verify log" shows ✅.
3. The money overview shows ✅.

The full checklist is in [docs/deployment.md](docs/deployment.md#6-pre-demo-checklist). To check the app locally instead, run `pnpm e2e` on its own.

## Known limitations

- **One shared demo dataset.** A reset or a skip affects every viewer at once.
- **Daily cron.** Vercel Hobby cron runs once a day, so scheduled jobs also run when pages load.
- **Straight-line distances.** Delivery distances are measured in a straight line, not by road.
- **Simulated partners.** Payments, payouts, logistics, sign-in and WhatsApp are simulated.
- **English only.** The screens are in English; the AI does read Malay and Chinese order text.
- **Paused projects.** Free Supabase projects pause after 7 idle days; the daily cron keeps the project awake.
