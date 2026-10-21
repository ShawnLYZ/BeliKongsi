# BeliKongsi — Build Design

Addendum to the product spec, written on 21 Oct 2026 from the brainstorming session.

| | |
|---|---|
| **Product spec** | [`2026-10-21-belikongsi-prd.md`](2026-10-21-belikongsi-prd.md), a word-for-word copy of the root `PRD.md`. Below it is called "the PRD". |
| **This document** | How BeliKongsi gets built: session decisions, changes to the PRD, environment and versions, architecture rules, data and security setup, testing, the deployment kit, P0 clarifications, P1 rules, milestones and story coverage. |
| **Precedence** | The PRD defines the product. Where this document differs from it, this document wins, and every such difference is listed in §2 with the PRD section it changes. Everything else here fills a gap the PRD leaves open. |
| **Scope** | All 160 P0 stories and 22 P1 stories, plus the P1 items named only in PRD §1 and §27. P2 stays roadmap only. |
| **Status** | Each section was approved in conversation on 21 Oct 2026. This written version awaits the user's review. |

---

## 1. Session decisions

| # | Decision |
|---|---|
| D1 | **Scope and pace.** Build every P0 and P1 item. There is no deadline: correctness and polish come before speed. P0 is finished (M10) before P1 starts (M11). |
| D2 | **No Docker, anywhere.** Local development, tests and CI run PostgreSQL 17 from the `embedded-postgres` npm package. Checked on the development machine on 21 Oct 2026: PostgreSQL 17.10 started natively on Windows, and roles, grants, row-level security, append-only triggers, row locks and template databases all worked as this design needs. |
| D3 | **The key file stays in the project folder.** `API_Key_Configuration.md` is not moved. This is the user's choice; O2 lists the safeguards. |
| D4 | **The user deploys.** The user creates the GitHub repository and the Vercel project and runs the production Supabase setup. Claude delivers the deployment kit (§7) and makes no changes to GitHub, Vercel or the production Supabase project unless asked. Read-only checks, such as reading the pooler settings, are allowed. |
| D5 | **Plans and execution.** All milestone plans (M0–M15) are written together once this document is approved, and the user reviews them as one set. Each plan starts with a re-sync task that checks the plan's assumptions against the code as built and corrects the plan before any code changes. Claude then executes the milestones in order and posts a short report at the end of each one without waiting. Claude stops only for a change to this spec, anything public or irreversible, and the two planned design approvals (D7, D8). |
| D6 | **Gemini model.** Chosen in M3 by running the 20-order accuracy set (§6.5) on `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`, with `gemini-3.5-flash` as the fallback. The cheapest model that gets at least 18 of 20 orders fully right with no invented product ids wins. The model name stays configuration (`GEMINI_MODEL`). Key 1 from the key file is used; the spare keys are never rotated in to get around rate limits (PRD §16). |
| D7 | **Product images.** Claude generates the 12 product images once with NVIDIA FLUX.2 Klein (PRD §17), and the user approves them from a single contact sheet before they are used. Planned stop in M3. |
| D8 | **Visual direction.** In M2, Claude renders two or three options for the Orbyte-style shell and the owner home, and the user picks one. The options take their cues from the Orbyte introduction deck: dark navy surfaces, white type, a blue primary colour with an amber accent, and white cards with coloured top borders. Planned stop in M2. |

## 2. Changes to the PRD

| # | PRD section | The PRD says | This build |
|---|---|---|---|
| O1 | §28 "Local development and tests"; Testing Decisions, "CI" | A local Postgres through Docker or the Supabase CLI local stack; API tests in CI against a Postgres service container | `embedded-postgres` 17.10 for local development, tests and CI (D2). The Supabase CLI local stack is never started. |
| O2 | §24 "The key file is never committed" | The key file is moved out of the repository folder before the first commit | The key file stays in the folder (D3). Safeguards: `.gitignore` names it; a pre-commit hook and a CI step (§5.6) reject any commit or tree that contains the file or any of its key patterns, including after `git add -f`; GitHub secret scanning and push protection are switched on when the repository is created (§7). |
| O3 | §1 P0 item 18; §28 "Production" | The team deploys to Vercel and publishes the repository | The user deploys (D4). P0 is complete when the deployment kit is delivered and every test passes against a local production build. The live link and the public repository follow the user's deploy. |
| O4 | §6.6 "Why this always ends correctly" | "Removing participations never lowers the total" | A typo: removing participations never **raises** the total, so the tier can only stay or fall and the price can only stay or rise. Nobody already dropped could have stayed in. The algorithm is unchanged. |
| O5 | §7 "Fortnightly cadence" | Cut-off every second Thursday (even ISO weeks) | Each fortnightly or monthly product stores the anchor week of its schedule; the default anchor gives even ISO weeks. The seed sets the anchor so that the demo week is a closing week, as §23 requires. |
| O6 | Sample dates in §13 and the example week | "Thu 6 Nov", "Tue 11 Nov", "Thu 13 Nov" | These follow the 2025 calendar. Tests anchor the demo week on Monday 2 Nov 2026, 06:05 MYT (ISO week 2026-W45): cut-off Thursday 5 Nov at 20:00, ready Tuesday 10 Nov, next cut-off Thursday 12 Nov. Live demo dates follow the demo clock. |
| O7 | §11 "Rules" | One delivery check per pickup | Unchanged in P0. P1 partial collection (P1-8) makes it one delivery check per collection. |

## 3. Environment and versions

**Development machine** (checked 21 Oct 2026): Windows 11; Node 24.16; pnpm 9.10 installed globally; Python 3.12; Git 2.54 (identity `ShawnLYZ`); GitHub CLI signed in as `ShawnLYZ`; Supabase CLI 2.109. Docker is installed but never used (D2).

**Supabase project:** `BeliKongsi`, ref `iwzctxxwotcgejswdlfz`, region `ap-southeast-1` (Singapore), PostgreSQL 17.11, healthy, not yet linked.

**Pinned versions.** These are the newest stable releases on 21 Oct 2026. M0 writes exact versions into `package.json`, and they change only deliberately.

| Package | Version | Note |
|---|---|---|
| `next` | 16.4.x | App Router |
| `react`, `react-dom` | 19.3.x | |
| `typescript` | 6.0.x | TypeScript 7 is released, but `typescript-eslint` supports only versions below 6.1 |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | 7.10.1 | `prisma@latest` currently points at an 8.0 release candidate, so always pin 7.10.1 |
| `tailwindcss` | 4.3.x | |
| `shadcn` (CLI) | 4.x | Components are copied into the repository |
| `zod` | 4.x | |
| `@google/genai` | 2.x | Server only |
| `@supabase/supabase-js` | 2.x | Server only, Storage only |
| `@vis.gl/react-google-maps` | 1.x | Browser, loaded lazily |
| `sharp` | latest stable | Seed-time image compression |
| `vitest` | 5.x | |
| `fast-check` | 4.x | |
| `@playwright/test` | 1.64.x | |
| `embedded-postgres` | 17.10.0-beta.17 | Matches Supabase's PostgreSQL 17 |
| `simple-git-hooks` | 2.x | Pre-commit secret check |

**Package manager.** pnpm 10.34.7, pinned in the `packageManager` field. The project `.npmrc` sets `manage-package-manager-versions=true`, so the globally installed pnpm 9.10 hands over to 10.34.7 automatically and nothing global changes. Dependency build scripts run only for packages on a reviewed allow-list (`onlyBuiltDependencies`), such as the `embedded-postgres` binaries (whose Linux install script restores symbolic links) and Prisma's engines.

**Ports.** Development Postgres 54329; test Postgres 54330; Next.js development server 3000; end-to-end server 3100.

## 4. Architecture

### 4.1 Layout

One Next.js application (PRD §2):

```
src/
  app/          role screens (owner, staff, supplier, ops), the shell, and api/ route handlers (paths exactly as PRD §20)
  server/
    engine/     Kongsi Engine (pure)
    modules/    one application service per PRD §3 module
    adapters/   clock, payments, logistics, ai, storage, images
    platform/   database client and transaction helper, session, permissions, errors, idempotency, environment
  components/   Orbyte shell and shadcn/ui components
  lib/          money and Malaysia-time formatting, shared types (nothing server-only)
prisma/         schema.prisma, migrations/, seed/ (builders, fixtures, assets)
scripts/        development database, image generation, storage and production setup, AI accuracy, secret check
tests/          engine/, api/, e2e/, fixtures/
docs/           superpowers/specs/, superpowers/plans/, deployment.md, engine-api.md, ai-accuracy.md
```

### 4.2 Rules

| # | Rule |
|---|---|
| R1 | **Thin route handlers.** A handler reads the session from the request, validates input with Zod, calls one service and shapes the response for the caller's role. Handlers never use `next/headers`, so API tests call them directly with real `Request` objects. |
| R2 | **One place for permissions.** Server components read through the same services as the API. Every change made in the browser goes through the JSON API; there are no Server Actions. |
| R3 | **One transaction per state change**, which also writes its ledger postings, activity log entries, notifications and integration events (PRD §2). Prisma interactive transactions run at READ COMMITTED with explicit row locks (`SELECT … FOR UPDATE`) and are retried up to 3 times on serialization failures and deadlocks. |
| R4 | **Money rules live only in the engine.** The services and the public engine API both call it. A lint rule stops `src/server/engine` from importing anything outside itself, including Node and Next.js modules. |
| R5 | **Fixed conventions.** Time comes only from the Clock adapter. Money is always integer sen: a JavaScript `number` in code, Postgres `integer` for amount columns and `bigint` for running balances. The database stores UTC; one formatter shows Malaysia time (`Asia/Kuala_Lumpur`); business weeks are ISO weeks in Malaysia time. |
| R6 | **Staff never receive money data.** Staff responses are built from dedicated staff view types with no money fields. A test scans every staff response for money-like keys (`sen`, `price`, `amount`, `total`, `balance`, `saving`, `fee`). |
| R7 | **The log stores ids, not names.** Activity log entries hold ids and business fields, never names or contact details; names are looked up when an entry is displayed. This keeps personal data out of the append-only chain (PRD §25) and lets P1-6 anonymise a shop without touching the log. |
| R8 | **Secrets stay on the server.** Server modules import `server-only`. The only value that reaches the browser is `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. |
| R9 | **Stable identifiers.** Ids are UUIDs (PRD §4). The seed derives them deterministically (UUID v5 from stable keys), so seeded ids are the same after every reset and in every test. |
| R10 | **One error shape and safe retries.** Errors are JSON `{ code, message, details }` with the status codes in PRD §2. Payment, approval and decision endpoints accept an `Idempotency-Key`; the first response is stored and replayed for repeats. |
| R11 | **Due work.** Owner and Ops page loads schedule any due jobs with Next.js `after()`, so pages aren't slowed down. A round past its cut-off shows "Closing…" until the close job has run. Demo controls run jobs immediately. |

## 5. Data, Supabase and security

### 5.1 Connections

| Variable | Used by | Production connection | Role |
|---|---|---|---|
| `DATABASE_URL` | the app at runtime | Supabase pooler, transaction mode, port 6543 | `bk_app` (pooler user `bk_app.iwzctxxwotcgejswdlfz`) |
| `MIGRATION_DATABASE_URL` | `prisma migrate deploy`, run from the user's machine | Supabase pooler, session mode, port 5432 (works over IPv4; the direct database host is IPv6-only) | `postgres` |
| none | "Reset demo data" | the database function `bk_demo_reset()` (§5.2) | runs with the owner's rights |

- Locally, both variables point at the embedded server: the app as `bk_app`, migrations as the server's superuser.
- The pooler host is read from the project's settings with the Supabase CLI and written into `docs/deployment.md`.
- Passwords inside connection URLs are percent-encoded.
- **Fallback.** If `bk_app` can't log in through the pooler (`pnpm prod:check` tests this during the user's deploy), the app uses the `postgres` role instead. Table ownership then bypasses row-level security, and the append-only triggers still apply. `docs/deployment.md` explains the switch.

### 5.2 What the migrations create

The same migrations run on Supabase, the development database and every test database.

- **Roles.** `bk_app` is created without login; `pnpm db:setup-role` (local) and `pnpm prod:setup-role` (production) enable login with a password taken from the environment, so no password is ever in git. `anon` and `authenticated` are created without login where they don't exist (plain PostgreSQL), so the same migrations and security tests run everywhere.
- **Row-level security** is enabled on every table, including `_prisma_migrations`, with one policy that admits only `bk_app`. All privileges are revoked from `anon` and `authenticated`, including default privileges for future tables (Supabase grants them by default).
- **Privileges for `bk_app`.** Read, insert, update and delete on business tables; read and insert only on the activity log and the ledger postings; usage on sequences; no `TRUNCATE` anywhere.
- **Append-only tables.** Triggers on the activity log and the ledger postings reject updates and deletes from every role.
- **Balances.** Ledger accounts carry a running balance, and a check constraint keeps shop balance, round hold and delivery fee hold accounts from going negative (PRD §6.11).
- **Hash chain head.** A single row that every log-writing transaction locks (PRD §14).
- **Demo settings.** `bk_app` may update the clock offset, the featured round and the reset timestamps, but not the demo-mode flag (column privileges).
- **`bk_demo_reset()`.** Runs with the owner's rights and refuses to act unless demo mode is on. It empties every data table, including the log and the ledger, and resets the chain head. "Reset demo data" calls it inside one transaction that then reseeds through the normal services and writes the first entry of the new chain, "demo reset" (PRD §14).

### 5.3 Storage

- **Buckets.** `product-images` (public) and `delivery-photos` (private; JPEG, PNG and WebP only; 5 MB maximum). `pnpm prod:storage` creates them idempotently with the service-role key and uploads the product images.
- **Delivery photos.** After a permission check, the server issues a signed upload URL. Photos are viewed through signed URLs that expire after 10 minutes (PRD §11).
- **Adapters.** `StorageAdapter` has two implementations: Supabase for production, and local disk (under `.data/storage`) for development, tests and the end-to-end run. The local one serves expiring, HMAC-signed links through a route handler, so no test touches the network.

### 5.4 Supabase CLI

- **Used (no Docker needed):** `projects list`, `link`, reading the pooler settings, storage object commands, and Supabase's security advisor through the Management API. The personal access token is passed as an environment variable for a single command and never stored.
- **Never used (they need Docker):** `start`, `stop`, `db diff`, `db dump`, `db pull`, `db reset`, `functions serve`, `gen types --local`.
- **Schema changes** are Prisma migrations only (PRD §28).

### 5.5 Environment variables

| Variable | Lives in | Secret |
|---|---|---|
| `DATABASE_URL` | server | yes |
| `MIGRATION_DATABASE_URL` | the user's machine only, never Vercel | yes |
| `BK_APP_DB_PASSWORD` | the user's machine only (role setup) | yes |
| `SUPABASE_URL` | server | no |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes |
| `GEMINI_API_KEY` | server | yes |
| `GEMINI_MODEL` | server | no |
| `AI_ADAPTER` (`gemini` or `fake`) | server | no |
| `STORAGE_ADAPTER` (`supabase` or `local`) | server | no |
| `SESSION_SECRET` | server | yes |
| `CRON_SECRET` | server | yes |
| `DEMO_MODE` | server | no |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | browser | restricted key (PRD §18) |
| `NVIDIA_API_KEY` | the user's machine only (image generation) | yes |
| `SUPABASE_ACCESS_TOKEN` | the user's machine only, per command | yes |

- The Supabase anon key is not used.
- All variables are validated at start-up with Zod, with separate server and browser schemas.
- `.env.local` (git-ignored) holds local values; `.env.example` lists names only.

### 5.6 Repository hygiene

- **`.gitignore`** covers the key file by name, `.env*` except `.env.example`, `.data/`, build output, and the user's source materials: the root `PRD.md`, `belibijak-product-features.md`, the two PDFs, `.claude/` and `skills-lock.json`.
- **Secret check.** `scripts/check-secrets` scans staged files (pre-commit hook through `simple-git-hooks`) and the whole tree (CI) for: the key file's name; `.env` files; Google API keys (`AIza…`); Gemini keys (`AQ.…`); Supabase personal access tokens (`sbp_…`); NVIDIA keys (`nvapi-…`); JSON Web Tokens (`eyJ….eyJ…`); private key blocks; and Postgres URLs with an inline password. Any hit fails the commit or the build.
- **The user's pre-deploy checklist** (in `docs/deployment.md`):
  - replace the database password with a random one (PRD §24)
  - consider regenerating the other keys, because the key file's contents were shared in the AI chat used to design this build
  - restrict the Maps key to the production domain and localhost, and to the Maps JavaScript API (PRD §18)
  - switch on secret scanning and push protection

## 6. Environments and testing

### 6.1 Local development

- `pnpm db:dev` starts the persistent embedded PostgreSQL in `.data/pg-dev` on port 54329, initialising it on first run.
- `pnpm db:reset` applies the migrations and seeds the demo dataset.
- `pnpm dev` runs the app on port 3000. `.env.local` selects the AI adapter, local storage and `DEMO_MODE=true`.

### 6.2 Engine tests (Vitest)

- One named test per PRD §6 rule and edge case, every §6.13 worked example, and the example week's amounts.
- The property tests listed in the PRD's Testing Decisions, with at least 1,000 runs per property locally and 5,000 in CI. A failure prints its seed and path for replay.
- A performance check: closing a round of 1,000 participations takes under 200 ms (PRD §22).

### 6.3 API tests (Vitest)

- One embedded server per test run on port 54330, with the initialised cluster cached in `.data/pg-test`.
- A template database is migrated once per run, and again only when the migrations change. Each test file gets its own copy (`CREATE DATABASE … TEMPLATE`, about 1 second).
- A fixed clock, the fake AI adapter, the simulated partners and local storage. Handlers are called directly (R1).
- Every scenario, permission, idempotency and log-integrity test in the PRD's Testing Decisions, plus:
  - `anon` can't read any table
  - `bk_app` can't update or delete log or ledger rows
  - staff responses contain no money fields (R6)
  - the money invariants (PRD §6.11) hold after every scenario

### 6.4 End-to-end test (Playwright)

- Phone viewport, 390 × 844. A production build (`next build`, then `next start` on port 3100) against a seeded embedded database with the fake AI adapter.
- Follows the demo script (PRD §23) and checks the amounts in C15, plus ✅ on "Verify log" and on the money overview.
- `BASE_URL` points the same test at the user's deployment for the pre-demo checklist.

### 6.5 AI accuracy set

- 20 messy orders with expected results in `tests/fixtures/ai-accuracy/`, covering everything the PRD's Testing Decisions list.
- `pnpm ai:accuracy` calls the real Gemini model, prints each order's result and writes `docs/ai-accuracy.md`, which the README summarises. Not part of CI.
- Pass mark: at least 18 of 20 orders fully correct, and no invented product ids.

### 6.6 CI (GitHub Actions)

- On every push and pull request: install (with pnpm packages and the Postgres binaries cached) → type check → lint → secret scan → engine tests → API tests on embedded Postgres.
- On `main`, also the end-to-end test.
- No service containers. CI runs once the user pushes; until then Claude runs the same steps locally at every milestone.

## 7. Deployment kit

Delivered by Claude in M10 and run by the user (D4).

- **`vercel.json`:** a daily cron that calls `/api/jobs/run`; functions in `sin1` (Singapore, beside the database); deployments from `main` only, so previews never touch the demo data (PRD §28).
- **`docs/deployment.md`**, step by step:
  1. create the public repository and switch on secret scanning and push protection
  2. import it into Vercel and set the production-only environment variables
  3. run the Supabase steps below
  4. restrict the Maps key
  5. rotate the keys and the database password
  6. run the pre-demo checklist from the PRD's Testing Decisions
- **Scripts:**
  - `pnpm prod:migrate`: `prisma migrate deploy` through `MIGRATION_DATABASE_URL`
  - `pnpm prod:setup-role`: enables `bk_app` login with its password
  - `pnpm prod:storage`: creates the buckets and uploads the product images
  - `pnpm prod:check`: connects as `bk_app` through the pooler, confirms row-level security on every table and the append-only triggers, and runs Supabase's security advisor
- **Seeding:** "Reset demo data" in the deployed app.
- **Cron:** Vercel sends `Authorization: Bearer $CRON_SECRET`, and the endpoint rejects anything else. The daily call also keeps the free Supabase project from pausing, which happens after 7 idle days.

## 8. P0 clarifications

| # | PRD reference | Gap | Resolution |
|---|---|---|---|
| C1 | §6.5; §23 step 2 | The quote counts the caller's own quantity, but the demo shows "99 cartons so far, 1 more for RM 146.00" | "Why this price?" shows both views. Without you: "99 cartons so far. 1 more and everyone pays RM 146.00." With you: "Your 6 take it to 105: the RM 146.00 tier. Your all-in price: RM 151.85." |
| C2 | §16; §23 step 1 | The AI's output has no price field, yet usual prices "come pre-filled from the sample" | "Try with sample data" fills the paste box with a fixed sample order (C14). Its usual prices come from a fixture and are labelled "sample price". Text the owner pastes never pre-fills prices, and the AI never reads money from orders. |
| C3 | §10; §9 "Complete other rounds" | Consignments are "one per hub, destination and delivery date", but goods can be hub-checked after a consignment has left | A consignment collects goods for its hub, destination and date while it is still planned. Goods checked in after it has been dispatched start a new consignment for the same key. "Complete other rounds" moves only consignments that carry no featured-round goods, so the demo's manual Ipoh step still works. |
| C4 | §10 | A pickup is ready once "all its consignments have arrived", but other rounds' goods may not have reached the hub yet | A pickup is ready (or out for delivery) only when every kept participation for that shop, destination and date has been hub-checked or refunded, and every consignment carrying its goods has arrived. P1-8 relaxes this. |
| C5 | §4 basket line; stories 33, 98 | What happens when staff add a product that is already in the basket | A basket has one line per product. A staff addition raises that line's quantity and highlights the change ("Rahim: +1"). When next week's basket is drafted over a draft that holds staff additions, usual-list quantities are merged the same way. |
| C6 | §19; stories 156, 163 | Who the switcher lists | In demo mode: every seeded account (simulated sign-in as that person) plus the current person's businesses and roles. Outside demo mode: only the current person's memberships. |
| C7 | §7 "How jobs are triggered" | How "due work" runs on page loads | See R11. |
| C8 | §23 "History" | How the previous week is seeded | By running the real services under a fixed clock, so its ledger, log chain and savings obey every invariant. Reset still finishes in under 10 seconds. If running the services is too slow, the seed writes the same rows in bulk through the same builders and engine. |
| C9 | §10 "Distances" | Which formula and rounding | Great-circle distance with an Earth radius of 6,371 km, rounded half-up to 0.1 km before banding. Seed coordinates reproduce the PRD's shipping shares (condensed milk to Ipoh RM 2.93; to Johor Bahru and Kuantan RM 4.29; Grade B eggs from the Johor hub to Kuantan RM 0.40), and tests check them. |
| C10 | Story 104 | The "required dispatch date" isn't defined | Cut-off plus 2 days (the Saturday), following §7's calendar. |
| C11 | §27 | "Time to approve" needs the moment the owner opens the basket | Each basket records when its owner first opened it, from P0 onwards. |
| C12 | §23 demo controls | When each control is built | Each arrives with the flow it drives: "Reset demo data" in M2 (finished in M9), "Use saved example" in M3, "Skip to cut-off" in M5, "Complete other rounds" in M7. |
| C13 | §14 | What the log may contain | See R7. |
| C14 | §23 step 1; story 11 | The sample order isn't written down | A fixture that mixes Chinese, Malay and English and includes a greeting and a phone number (redacted before the AI call). It contains 6 cartons of condensed milk, no evaporated milk (staff add that in the demo), and one egg line without a grade, which is highlighted with Grade A and Grade B as alternatives (the demo picks Grade A). M3 fixes its exact text and sample prices (condensed milk RM 165.00), which the fake AI adapter and the end-to-end test share. |
| C15 | Testing Decisions, end-to-end test | "RM 984.54 paid", but the basket also has other lines | The end-to-end amounts are these: RM 984.54 is the condensed-milk line on the receipt; RM 73.44 the condensed-milk refund at cut-off; RM 123.30 Kafe Contoh's Grade B egg refund; RM 15,330.00 the condensed-milk supplier order; RM 151.85 the claim refund; RM 65.75 the condensed-milk verified savings. |
| C16 | §16 open item | Which Gemini model | See D6. |
| C17 | §17 | Who reviews the images | See D7. |

## 9. P1 rules

Rules marked **decision** are additions or choices the PRD doesn't state.

### M11: owner automation and money

- **P1-1 Auto-approve** (stories 40–41). The owner switches the rule on with a spending cap (default RM 500) and the condition "every line's starting all-in price is below my usual price" (on by default; a line without a usual price fails it). The rule is checked once, straight after Monday's basket is drafted. If it passes, the basket is approved by "system (auto-approve rule)" and paid: balance first, then the rest by simulated DuitNow AutoDebit. If that collection fails, the basket stays a draft and the owner is asked to pay by hand. Lines can still be cancelled before cut-off. Switching the rule on or off, and every auto-approval, are logged.
  - **Decision:** when switching the rule on, the owner agrees to a simulated AutoDebit mandate, because an auto-approval can't show a checkout screen. Only a mandate reference is stored, never bank details (story 146).
- **P1-2 Withdrawal** (story 60). Any amount up to the balance is paid out to the bank account the payments partner holds (simulated; no details stored). Posting: shop balance → partner cash (PRD §8), with a receipt and a log entry.
- **P1-3 Monthly summary** (story 89). From 09:00 MYT on the 1st of each month, each owner is sent last month's verified savings, rounds, refunds and fees, once per shop per month.
- **P1-4 Time saved** (story 90). The owner enters the minutes a week ordering used to take. Each week's estimate is that figure minus the measured time from first opening the basket (C11) to paying, never below zero, labelled "estimate".
- **P1-5 Data export** (story 88). One ZIP of CSV files: orders, payments, money history and savings. The export is logged.
- **P1-6 Deletion request** (story 149), **decision.** The owner's request becomes an Ops approval of type "data deletion". Ops can approve it only when the shop has no active rounds, open pickups or open claims, and its balance is zero (the owner withdraws first). Approval anonymises the shop and its people: names, address, coordinates and contact details are cleared, memberships are ended, people with no other membership are anonymised, and photos are deleted. Money records stay, under the anonymous id, for the accounting retention period (PRD §25). The log needs no change (R7).

### M12: delivery exceptions

- **P1-7 Late delivery** (story 74).
  - A pickup is late when it isn't ready, or out for delivery, by its expected ready time (Tuesday 10:00 MYT in the default calendar). Owner and staff are told it is late; staff never see amounts.
  - Ops, acting as the logistics partner, can set a new date on a consignment, with a reason. Everyone affected is told the new date.
  - From 3 days after the original expected time, the owner can cancel any item in that pickup for a full refund (allocated units × final all-in price). **Decision on the money:**
    - Before the round's hub check: the refund comes from the round hold, and the supplier order accepts that many fewer units. Units above the accepted quantity are flagged at the hub check and not paid for, like any excess (PRD §9).
    - After the hub check: the refund comes from claims expense, recoverable from the logistics partner (like damage after the hub).
  - The delivery fee is refunded too if no door lines remain for that date and nothing has been dispatched.
- **P1-8 Partial collection** (PRD §1, §10). Once some of a pickup's consignments have arrived, those goods can be collected with the same code and checked. The rest keeps waiting. Each collection gets its own delivery check (O7). Later partial deliveries never add delivery fees.
- **P1-9 Uncollected goods** (stories 75, 135). Owner and staff get reminders 1 day and 3 days after the pickup became ready. Ops is alerted after 7 days.
- **P1-10 Delivery-check window** (story 83; PRD §11). After collection or delivery there is a 72-hour window, with a reminder at 24 hours. At 72 hours the pickup closes as "received, not checked": its savings stay estimated and no claim can be filed.
- **P1-11 Reminders** (stories 116, 134; PRD §12).
  - A supplier confirmation pending for 12 hours reminds the supplier and notifies Ops.
  - An Ops approval (supplier order or claim) pending for 12 hours reminds every Ops user and is marked overdue in the inbox.
  - An order not dispatched by the end of its required dispatch date (C10), or not hub-checked by the end of its expected hub date (the Monday after cut-off), alerts Ops.
  - Every reminder is sent once (idempotent).

### M13: supplier self-service

- **P1-12 Catalogue editing** (stories 113, 115).
  - Suppliers create and edit their own products: name, pack, unit, weight, aliases, buy-alone price, tiers (validated by the engine) and schedule (cadence, anchor week, cut-off weekday and time; default Thursday 20:00).
  - Changes apply from the next round; the open round keeps its frozen snapshot.
  - A new product's first round opens straight away. Deactivating a product lets its open round finish and stops new ones.
  - Suppliers can upload a photo; otherwise the category icon shows. Images are never generated at runtime.
- **P1-13 AI price-list import** (story 114). The supplier pastes text or uploads a photo, and Gemini drafts tier tables, matched to the supplier's products or as new product drafts. Nothing is saved until the supplier confirms. Limited to 10 imports per supplier per hour, and logged like usual-list reading.

### M14: AI photo and impact

- **P1-14 Invoice photo** (story 26), **decision.** Output, validation and confirmation are the same as for pasted text. A photo can't be redacted before it is sent, so the upload screen asks the owner to cover names and phone numbers. The photo goes to Gemini and is never stored by BeliKongsi. The privacy notice says so.
- **P1-15 Impact panel** (PRD §27). An Ops page showing time to approve the weekly basket, basket approval rate, AI lines accepted unchanged, claim rate, and supplier reliability (confirmation time; good units ÷ ordered units).

### M15: governance and integration

- **P1-16 Log filters and CSV export** (story 144). Filters by date range, person, action and subject; exporting is itself logged.
- **P1-17 Webhooks** (story 161; PRD §21).
  - Apps register an HTTPS address and the event types they want through the integration API, using the simulated Orbyte app credential header (as for the engine API). The signing secret is shown once.
  - **Delivery:** each delivery carries the event and is signed with HMAC-SHA256 over the timestamp and body. Deliveries go out right after the change commits.
  - **Retries:** after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours; after that the delivery is marked failed.
  - **Safety:** private and loopback network addresses are refused.
  - **Visibility:** Ops sees subscriptions and delivery attempts on the integration events page. In demo mode, a built-in receiver at `/api/demo/webhook-receiver` shows deliveries arriving.
- **P1-18 Emergency cancellation** (story 136; PRD §5). Ops cancels an open round with a required reason. Every participation is refunded in full, delivery fees are refunded where no door lines remain, owners are notified and `round.cancelled` is emitted. The next round opens as usual unless Ops also pauses the product.
- **P1-19 Photo deletion** (story 148). A daily job deletes delivery photos 90 days after upload, notes the deletion on the claim and logs it.
- **P1-20 About page** (story 173). A public page covering the problem, the five-step journey, the Orbyte fit, the SDGs, PDPA and the simulation notices.

## 10. Milestones

Each milestone is built test-first. It is done when its checks below pass along with the full test suite, type check and lint.

| # | Scope | Done when |
|---|---|---|
| M0 | **Foundation.** Git hygiene (§5.6) and the pre-commit secret check; Next.js scaffold with strict TypeScript; ESLint (with the engine boundary rule) and Prettier; Tailwind and the shadcn/ui base; Vitest projects (engine, api) and Playwright configuration; the embedded-postgres development server and test harness; Prisma 7 with the baseline migration (roles and default privileges, §5.2); environment validation; `/api/health`; the CI workflow; README and `docs/deployment.md` skeletons; a read-only check of the Supabase pooler settings. | Type check, lint, sample engine and API tests, and `next build` pass; the harness creates and drops a database per test file; `/api/health` reaches the development database as `bk_app`. |
| M1 | **Kongsi Engine.** All of PRD §6: money helpers and rounding, tier validation, unit amounts, quotes, closing rounds, shortfall allocation, claim refunds, savings and explanations. The public engine API v1 (quote, close-round, allocate-shortfall) and `docs/engine-api.md`. | Every example test (§6.13, the example week, the edge cases) and every property test passes; closing 1,000 participations takes under 200 ms. |
| M2 | **Data model and Orbyte shell.** The full schema (PRD §4) and the §5.2 database objects; the ledger (accounts, postings, balances, invariant checks); the activity log (hash chain, role-filtered queries, timelines, verification); the clock with demo offset; seed builders with deterministic ids (network, suppliers, catalogue, shops, users, memberships); basic "Reset demo data"; simulated sign-in, session, business and role switcher, "Made-up data" banner; approvals inbox and notifications with WhatsApp previews and share links; the permission layer and response shaping; adapter interfaces. Visual-direction stop (D8). | Sign in as any seeded user and switch roles; each role sees its inbox, notifications and log; "Verify log" ✅ after reset; permission and log-integrity API tests pass. |
| M3 | **Catalogue, rounds and usual list.** Catalogue search by name, alias and shorthand; rounds (opening due rounds with frozen tiers and fee, progress, the quote API); the logistics adapter (distances, rate card, delivery fee, too-far rule); product images (generation, review stop D7, compression, fallback icons); the usual list (catalogue form, Gemini adapter with a JSON schema, redaction, validation, fake and saved-example adapters, rate limit, suggestion runs, logged confirmation); the 3-step setup with the data notice and "Try with sample data"; the pickup point picker (map and distance-sorted list) and door delivery quote; settings; the model choice (D6). | Kedai Kopi Contoh completes setup from the sample order (one highlighted line resolved) and picks the Ipoh pickup point; quotes match the rate card (condensed milk to Ipoh: RM 2.93 shipping, RM 164.09 starting all-in). |
| M4 | **Weekly basket and payments.** Drafting (Monday 06:00 and after setup) and composition; staff additions, including after payment; owner edits and the fulfilment switch; line quotes and "Why this price?"; approve and pay (re-quote, balance first, simulated DuitNow QR and FPX checkout with success and failure, idempotent results); ledger postings; receipts; money history; delivery fee charges; joining from the catalogue with the price-limit warning; cancelling before cut-off; skipping; reminders (24 hours and 3 hours); expiry and voided payments; the staff home ("Add to next basket"); the owner home's basket card with countdown; seeded paid participations for Gerai Contoh, Kafe Contoh and the background shops, created through the same services. | Kedai Kopi Contoh pays its basket; the receipt shows condensed milk 6 × RM 164.09 = RM 984.54; the condensed milk round shows 105 cartons at tier 3; the payment-failure, retry and balance-covers-all scenarios pass. |
| M5 | **Round close and outcomes.** The close-due-rounds job (engine close, outcomes, refunds, postings, empty, failed and formed rounds, dropouts, opening the next round); drafting supplier orders and their Ops approval requests; notifications with WhatsApp text; the integration event outbox and the Ops events page; the protected jobs endpoint and due-work trigger; "Skip to cut-off"; "My Kongsi" outcomes. | After "Skip to cut-off", Kedai Kopi Contoh gets RM 73.44 back on condensed milk and Kafe Contoh's Grade B eggs line is refunded RM 123.30; running the close job twice changes nothing; two concurrent closes produce one outcome. |
| M6 | **Ops approvals and supplier portal.** The approvals inbox for every role; supplier order approval with evidence and the money check; rejection by Ops or the supplier with full refunds; the supplier portal (orders, confirm with a dispatch date, reject, dispatched, read-only products and tiers, open round totals, payouts); the hub check with allocation preview, settlement postings, simulated payout and shortfall notices; the Ops rounds board (with success rate, average tier and shops per round) and round detail; the money overview with invariant checks; the "Verify log" page. | The condensed milk order (105 cartons, RM 15,330.00, 9 shops, money check ✅) is approved, confirmed, dispatched and hub-checked with 105 good units, and the supplier is paid RM 15,330.00; the shortfall, Ops-rejection and supplier-rejection scenarios pass. |
| M7 | **Fulfilment.** Consignments (C3) and pickups with codes (C4); partner status buttons; door delivery (out for delivery, delivered); delivery fees moving to logistics payable at dispatch, and refunds before dispatch; background-shop automation; "Complete other rounds"; owner and staff pickup trackers and codes; ready and out-for-delivery notifications; the Ops consignments board and network map. | After "Complete other rounds" and the Ipoh consignments' dispatched → arrived steps, Kedai Kopi Contoh's pickup is ready, with a 6-digit code visible to the owner and staff. |
| M8 | **Delivery check and claims.** Collecting with the code (422 for a wrong code); the staff check screen without prices; "All received" and "Report a problem" (missing and damaged per line); photo uploads through signed URLs; claims with engine refunds; Ops claim review (photos, check, hub record and consignment history side by side); approve or reject with a reason; notifications (owners with amounts, staff without); the full-lifecycle API test. | Staff report 1 damaged carton with a photo, Ops approves, and RM 151.85 lands in Kedai Kopi Contoh's balance; the full happy-path API test passes. |
| M9 | **Savings, demo and polish.** Savings (estimated, then verified) and the monthly summary; the owner home (savings, balance, next pickup, approvals); "My Kongsi" history with delivery results; timelines on every subject; the seeded history week; about 40 background shops with the designed totals (condensed milk 99 cartons, Grade B eggs 130 trays) and the featured round; reset in under 10 seconds; empty, error and loading states on every screen; an accessibility and phone-width pass; an honesty-label audit. | The home screen shows RM 65.75 verified savings for condensed milk; "Reset demo data" restores the seeded state in under 10 seconds with "Verify log" ✅ and the money overview ✅. |
| M10 | **P0 release.** The end-to-end test (demo script); the AI accuracy run recorded; the README with every item in PRD §28; `docs/engine-api.md` finished; the deployment kit (§7); `pnpm audit` clean. | The full suite, including the end-to-end test, passes against a local production build; the README and deployment guide are complete. **P0 complete.** |
| M11 | **P1: owner automation and money** (P1-1 to P1-6). | Each rule has passing API tests; the end-to-end test still passes. |
| M12 | **P1: delivery exceptions** (P1-7 to P1-11). | As M11. |
| M13 | **P1: supplier self-service** (P1-12, P1-13). | As M11. |
| M14 | **P1: AI photo and impact** (P1-14, P1-15). | As M11, plus the accuracy run repeated with synthetic invoice photos. |
| M15 | **P1: governance and integration** (P1-16 to P1-20), and the final release: README, deployment guide and end-to-end test updated for P1. | The full suite passes against a local production build. **P0 and P1 complete.** |

## 11. Story coverage

Every P0 and P1 story is owned by one milestone. A story that touches several milestones (for example, a permission rule) is owned where its rule is first enforced, and later milestones test it again.

| Milestone | Stories |
|---|---|
| M0 | 151 |
| M1 | 158, 159, 174, 175, 178, 180 |
| M2 | 1, 2, 91, 92, 93, 99, 101, 137–143, 145, 152, 155, 156, 157, 163, 166, 167, 179, 184 |
| M3 | 3–8, 11–25, 42–45, 48–51, 154, 170, 172, 183 |
| M4 | 9, 27–39, 46, 47, 52–58, 95–98, 102, 146 |
| M5 | 59, 61–64, 66, 68, 94, 132, 160, 164, 177 |
| M6 | 65, 103–112, 117–123, 129–131, 176 |
| M7 | 69–73, 100, 124–126, 133, 165 |
| M8 | 76–81, 127, 128, 147, 181 |
| M9 | 10, 67, 82, 84–87, 171 |
| M10 | 153, 168, 169, 182 |
| M11 | 40, 41, 60, 88, 89, 90, 149 |
| M12 | 74, 75, 83, 116, 134, 135 |
| M13 | 113, 114, 115 |
| M14 | 26 |
| M15 | 136, 144, 148, 161, 173 |

P0 total: 160 stories (M0–M10). P1 total: 22 stories (M11–M15), plus the PRD §1 and §27 items covered by P1-8, P1-10, P1-11 and P1-15. P2 stories (150, 162, 185–195) stay roadmap only.
