# M10 P0 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P0 is complete and ready for the user to deploy:

- A phone-sized end-to-end test follows the demo script and checks every key amount.
- The README tells judges everything PRD §28 lists.
- The deployment kit lets the user put BeliKongsi live on Vercel and Supabase safely, with one command per step.

**Architecture:**

- A Playwright webServer script boots an isolated end-to-end database (port 54331) and a production build (port 3100).
- The same spec runs against the user's live URL when `BASE_URL` is set.
- The deployment kit is configuration plus four `prod:*` scripts. `prod:check` proves the security baseline on the live database.

**Tech Stack:** Playwright 1.64, embedded-postgres, Supabase CLI and Management API (read-only), Vercel configuration.

**Spec:** PRD §23 (demo script), §24, §28 (deployment, README contents), Testing Decisions (end-to-end test, pre-demo checklist), stories 153, 168, 169, 182; build design §5, §6.4, §7, C15, O3, D4; index §5.8.

## Global Constraints

- Index §2 (G1–G10) applies.
- C15 amounts, asserted as visible text:
  - RM 984.54 (the condensed-milk receipt line)
  - RM 73.44 (the condensed-milk refund)
  - RM 123.30 (Kafe Contoh's Grade B egg refund)
  - RM 15,330.00 (the supplier order)
  - RM 151.85 (the claim refund)
  - RM 65.75 (condensed-milk verified savings)
  - ✅ on "Verify log" and on the money overview
- The end-to-end test runs at a phone viewport of 390 × 844 with the fake AI adapter locally (G10). With `BASE_URL` it runs against the deployed app, which uses real Gemini.
- D4: Claude doesn't create the repository, deploy, or change the production Supabase project; the kit is run by the user. Nothing here writes a secret into a tracked file (G6).
- PRD §28 README contents:
  - the problem, the solution and the five-step journey
  - an architecture overview, how to run locally, and environment variable names (never values)
  - how to seed and reset, and the demo script
  - the Kongsi Engine API with examples, how to run the tests, and the AI accuracy results
  - the synthetic-data and simulation notices, and known limitations

## Review Focus

1. **The end-to-end test run twice in a row:** it starts with "Reset demo data", so the second run passes like the first. Pinned in Task 1.
2. **Against the live URL, real Gemini reads the eggs line without a highlight:** the test only picks Grade A when the line asks for a check, and still passes. Pinned in Task 1.
3. **`prod:check` run while the app connects as `postgres`** (the fallback): it reports "fallback mode" as a warning with an explanation, not a silent pass. Pinned in Task 3.
4. **A Vercel deployment missing an environment variable:** start-up fails, naming it, and `.env.example` lists every variable `getServerEnv` reads. Pinned in Task 3.
5. **Port 3100 already taken by a stray server:** locally the test reuses it only when it answers `/api/health`; in CI it fails with a clear message. Pinned in Task 1.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m10-p0-release`
- [ ] **Step 2:** Follow index §6. Also check:
  - Vercel's current `vercel.json` schema for `crons`, `regions` and `git.deploymentEnabled`, including whether branch patterns such as `"*"` are allowed.
  - The Supabase Management API's security advisor endpoint (`GET /v1/projects/{ref}/advisors/security`).
  - Correct Task 3 if either differs.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: The end-to-end demo test

**Files:**

- Create: `scripts/e2e-server.ts`, `tests/e2e/demo.spec.ts`, `tests/e2e/helpers.ts`, `tests/fixtures/photos/dented-carton.jpg` (a small synthetic JPEG made with `sharp`: a grey 640 × 480 image)
- Delete: `tests/e2e/smoke.spec.ts`
- Modify: `playwright.config.ts` (webServer = `tsx scripts/e2e-server.ts`; `timeout: 180_000`; one worker; `reuseExistingServer` only after a successful `/api/health` probe and never in CI), `package.json` (`e2e`, and `e2e:server`)

**Interfaces:**

- Produces:
  - `scripts/e2e-server.ts`:
    - Starts `.data/pg-e2e` on port 54331 and recreates the database `belikongsi_e2e`.
    - Runs `prisma migrate deploy` and the role setup with password `e2e`.
    - Runs `next build` (unless `SKIP_BUILD=1`), then `next start -p 3100`.
    - Environment: `DATABASE_URL=postgresql://bk_app:e2e@localhost:54331/belikongsi_e2e`, `AI_ADAPTER=fake`, `STORAGE_ADAPTER=local` with the folder `.data/storage-e2e`, `DEMO_MODE=true`, and fixed local secrets.
  - `tests/e2e/helpers.ts`: `switchTo(page, displayName)`, `demo(page, 'Reset demo data' | 'Skip to cut-off' | 'Complete other rounds')`, `expectMoney(page, text)`.

- [ ] **Step 1: Write the test**, one `test.step` per PRD §23 step:
  1. **Reset, then setup as Ah Seng.**
     - Open `/sign-in`, choose "Continue with Microsoft", then Ah Seng.
     - Demo → Reset demo data.
     - Setup: "Try with sample data" → read.
     - If the eggs line shows "Please check", choose Grade A.
     - Expect the condensed milk usual price "RM 165.00" labelled "sample price".
     - Confirm, choose "Ipoh pickup point" from the list, and expect "Done".
  2. **Staff addition.** Switch to Rahim, "Add to next basket", evaporated milk ×1, and expect "Waiting for owner's approval". Switch back to Ah Seng and expect the highlight "Rahim: +1".
  3. **Pay.**
     - "Why this price?" on condensed milk shows "99 cartons so far. 1 more carton and everyone pays RM 146.00."
     - "Approve & pay" → DuitNow QR → "Pay (simulated)".
     - The receipt shows "RM 984.54" on the condensed milk line.
     - Open rounds shows "105 cartons" and tier 3.
  4. **Cut-off.** Demo → Skip to cut-off. Ah Seng's notifications contain "RM 73.44 is back in your balance". Switch to Mei: her notifications contain "Full refund: RM 123.30".
  5. **Supplier order.**
     - Switch to Nadia. The inbox shows the condensed milk order with "105 cartons", "RM 15,330.00", "9 shops" and "✅". Approve.
     - Switch to Farid: confirm with the date `2026-11-07` (or the date the UI offers as required), then "Mark dispatched".
     - Nadia: hub check with 105 good → preview → confirm.
     - Demo → Complete other rounds.
     - Nadia: the Ipoh consignments → "Dispatched" → "Arrived".
  6. **Delivery check and claim.**
     - Switch to Rahim: "Confirm delivery" → the pickup → enter the code shown on screen → "Collected".
     - Condensed milk: "Report a problem", damaged 1, attach `dented-carton.jpg`; the other lines are received; submit.
     - Nadia: the claim → "Approve". Expect "RM 151.85".
  7. **Close-out.**
     - Ah Seng: the savings page shows "RM 65.75" for condensed milk, marked verified.
     - Nadia: "Verify log" shows ✅; the money overview shows all ✅.
- [ ] **Step 2: Implement** the server script and helpers, and replace the M0 smoke test. Run `pnpm e2e`. Expected: 1 passed.
- [ ] **Step 3:** Run `pnpm e2e` a second time without restarting the database. Expected: 1 passed, because the test starts with a reset.
- [ ] **Step 4: Commit:** `test(e2e): follow the demo script at phone size`

---

### Task 2: README and documentation

**Files:**

- Modify: `README.md`, `docs/engine-api.md`, `docs/ai-accuracy.md`

- [ ] **Step 1: Write `README.md`.** It covers every PRD §28 item (Global Constraints), plus:
  - **Status:** P0 complete, P1 in progress.
  - **Synthetic data and simulation:** every business, person and product is made up ("… Contoh"). Payments, payouts, logistics, sign-in and WhatsApp are simulated.
  - **The five-step journey:** PRD "How the journey maps to the brief's five steps".
  - **An architecture overview:** layers, modules, the engine, adapters, and where security lives, with a short diagram in Markdown.
  - **Local setup:** `pnpm install`, `pnpm db:dev`, `pnpm db:reset`, `pnpm dev`; and the environment variable names from `.env.example`.
  - **The demo script:** PRD §23.
  - **The Engine API:** a summary linking `docs/engine-api.md`.
  - **Tests:** `pnpm test`, `pnpm e2e`, `FC_NUM_RUNS`.
  - **The AI accuracy results:** from `docs/ai-accuracy.md`.
  - **Deployment:** a link to `docs/deployment.md`.
  - **Known limitations:**
    - one shared demo dataset, so a reset or skip affects every viewer
    - Vercel Hobby cron runs daily, with jobs also running on page loads
    - straight-line distances
    - simulated partners
    - English only
    - free Supabase projects pause after 7 idle days, which the daily cron prevents
- [ ] **Step 2: Finish `docs/engine-api.md`.** Add a `curl` example per endpoint and the error format.
- [ ] **Step 3:** Run `pnpm check:secrets --all` and `pnpm format:check`. Expected: both pass.
- [ ] **Step 4: Commit:** `docs: complete the README for judges`

---

### Task 3: The deployment kit

**Files:**

- Create: `vercel.json`, `scripts/prod-migrate.ts`, `scripts/prod-setup-role.ts`, `scripts/prod-storage.ts`, `scripts/prod-check.ts`, `scripts/lib/security-checks.ts`
- Modify: `docs/deployment.md` (complete), `.env.example` (final), `package.json` (`prod:migrate`, `prod:setup-role`, `prod:storage`, `prod:check`), `src/server/platform/env.ts` (export `serverEnvKeys(): string[]`, the keys of the server Zod schema)
- Test: `tests/api/deployment-kit.test.ts`

**Interfaces:**

- Produces:
  - `vercel.json`:
    - `{ "crons": [{ "path": "/api/jobs/run", "schedule": "0 22 * * *" }], "regions": ["sin1"], "git": { "deploymentEnabled": { "main": true, "*": false } } }`
    - `0 22 * * *` UTC is 06:00 MYT daily, so the Monday cron drafts baskets on time.
    - Use the exact `git` syntax confirmed in Task 0.
  - `runSecurityChecks(adminUrl: string, appUrl: string): Promise<{ checks: { id: string; passed: boolean; warning?: boolean; detail: string }[] }>`. The checks:
    - the app's `current_user`, where `postgres` is the fallback warning (§5.1)
    - row-level security and the `bk_app_all` policy on every `public` table
    - `has_table_privilege('anon' | 'authenticated', table, 'SELECT')` false everywhere
    - the append-only triggers present on both tables
    - no `TRUNCATE` for `bk_app`
    - `bk_demo_reset` is `SECURITY DEFINER`
  - The scripts:
    - `prod:migrate`: `prisma migrate deploy` with `MIGRATION_DATABASE_URL`.
    - `prod:setup-role`: the same as `db:setup-role`, against the production URL.
    - `prod:storage`: creates the buckets `product-images` (public) and `delivery-photos` (private; `image/jpeg`, `image/png`, `image/webp`; 5 MB) if they're missing, then uploads `prisma/seed/assets/products/*.webp` with upsert.
    - `prod:check`: `runSecurityChecks`, plus the Supabase security advisor when `SUPABASE_ACCESS_TOKEN` is set. It prints a table and exits 1 on any failure.
  - `docs/deployment.md`: the build design §7 steps, each with the exact command, the expected output and what to do if it fails. Included:
    - the Vercel environment variable list (§5.5), marked production-only
    - `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel uses pnpm 10.34.7
    - the region `sin1`
    - turning on secret scanning and push protection (`gh api -X PATCH repos/<owner>/<repo> -f security_and_analysis[secret_scanning][status]=enabled -f security_and_analysis[secret_scanning_push_protection][status]=enabled`)
    - Maps key restriction (HTTP referrers: the production domain and `http://localhost:3000/*`; API restriction: Maps JavaScript API)
    - the key rotation list (§5.6)
    - "Reset demo data" as the seed step
    - the PRD pre-demo checklist

- [ ] **Step 1: Write the failing tests:**

```ts
it('passes every security check on a migrated database', async () => {
  const db = await createTestDatabase();
  const r = await runSecurityChecks(db.adminUrl, db.appUrl);
  expect(r.checks.filter((c) => !c.passed)).toEqual([]);
});
it('warns when the app connects as postgres (fallback mode)', async () => {
  const db = await createTestDatabase();
  const r = await runSecurityChecks(db.adminUrl, db.adminUrl);
  expect(r.checks.find((c) => c.id === 'app_role')).toMatchObject({ passed: true, warning: true });
});
it('lists every environment variable the server reads in .env.example', () => {
  const names = readFileSync('.env.example', 'utf8')
    .split('\n')
    .map((l) => l.split('=')[0]);
  for (const k of serverEnvKeys()) expect(names).toContain(k); // serverEnvKeys() exported from env.ts
});
it('schedules the job runner daily at 06:00 Malaysia time in Singapore', () => {
  const v = JSON.parse(readFileSync('vercel.json', 'utf8'));
  expect(v.crons).toEqual([{ path: '/api/jobs/run', schedule: '0 22 * * *' }]);
  expect(v.regions).toEqual(['sin1']);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Run `pnpm prod:check` against the dev database by setting `DATABASE_URL` and `MIGRATION_DATABASE_URL` to the dev URLs in the shell. Expected: every check passes; the advisor is skipped without a token.
- [ ] **Step 6: Commit:** `feat(deploy): add the deployment kit and security checks`

---

### Task 4: The pre-demo checklist and a clean audit

**Files:**

- Create: `scripts/predemo.ts`
- Modify: `package.json` (`predemo`), `README.md` (a "Before every demo" section)

- [ ] **Step 1: Implement `pnpm predemo`.**
  - It runs `pnpm audit --prod`, then `pnpm ai:accuracy` (skipped with `--skip-ai`), then `BASE_URL=<--url> pnpm e2e` (skipped without `--url`).
  - It finishes by printing the manual checks: "Reset demo data", "Verify log" ✅, money overview ✅.
- [ ] **Step 2:** Run `pnpm audit --prod`. Fix high and critical advisories by upgrading within the pinned majors. List any accepted advisory, with its reason, under README "Known limitations".
- [ ] **Step 3:** Run `pnpm predemo --skip-ai`. Expected: the audit passes and the local end-to-end test passes.
- [ ] **Step 4: Commit:** `chore: add the pre-demo checklist; clear audit findings`

---

### Task 5: Release verification

- [ ] **Step 1:** Run `pnpm verify && pnpm e2e && FC_NUM_RUNS=5000 pnpm test:engine`. Expected: all pass.
- [ ] **Step 2: Check the client bundle (stories 151, 152).** Add `scripts/check-client-bundle.ts` and run it after `pnpm build`.
  - It scans `.next/static/**/*.js` for any `serverEnvKeys()` name and for the key patterns from `scripts/lib/secret-patterns.ts`. The Google pattern is excluded here, because the Maps key is the one intended browser value.
  - It also checks that no client chunk contains `@supabase/supabase-js`, `@prisma/client` or `pg`.
  - Expected: nothing found.
  - Add it to `verify` after `build`.
- [ ] **Step 3:** Add `e2e` to the `verify` script for later milestones: `"verify": "… && pnpm build && pnpm check:bundle && pnpm e2e"`.
- [ ] **Step 4: Commit:** `chore: check the client bundle and include the end-to-end test in verify`
- [ ] **Step 5:** Merge to `main` with `--ff-only`. Post the milestone report, marked **P0 complete** (stories 153, 168, 169, 182, and the P0 total). Include the user's next steps from `docs/deployment.md`: create the public repo, Vercel, the Supabase steps, key rotation and the Maps restriction. Claude doesn't wait; M11 starts next.
