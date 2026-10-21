# M0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repository where the toolchain, the secret check, the embedded Postgres dev and test databases, Prisma 7 with the security baseline, a health endpoint and CI all work, so that M1–M15 only add product code.

**Architecture:** One Next.js 16 app (App Router, TypeScript 6) with Tailwind 4 and shadcn/ui. Prisma 7 reaches Postgres through `@prisma/adapter-pg`. Postgres comes from `embedded-postgres` for development (port 54329) and tests (port 54330); API tests get a fresh database per file, cloned from a migrated template. Every migration ends by calling `bk_secure_all_tables()`, which enforces row-level security and the `bk_app` grants.

**Tech Stack:** pnpm 10.34.7, Next.js 16.4, React 19.3, TypeScript 6.0, Tailwind 4.3, shadcn/ui, ESLint 9 (flat config), Prettier, Vitest 5, Playwright 1.64, Prisma 7.10.1, embedded-postgres 17.10.0-beta.17, simple-git-hooks 2, tsx.

**Spec:** PRD + build design (§3, §4, §5.2, §5.5, §5.6, §6.6) — see the [index](2026-10-21-belikongsi-00-index.md).

## Global Constraints

- Index §2 (G1–G10) applies to every task. Read it first.
- `packageManager`: `pnpm@10.34.7`; `.npmrc`: `manage-package-manager-versions=true` (build design §3).
- `prisma`, `@prisma/client`, `@prisma/adapter-pg`: exactly `7.10.1` — never `latest` (it points at an 8.0 release candidate).
- Ports: dev Postgres 54329, test Postgres 54330, end-to-end server 3100.
- Every migration ends with `SELECT bk_secure_all_tables();`. Append-only tables: `activity_log_entries`, `ledger_postings` (build design §5.2).
- `bk_app` never gets `TRUNCATE`, and its password never appears in git (§5.2).

## Review Focus

1. **A crash leaves a stale `postmaster.pid`** in a cluster folder: the next start must remove it and start normally, not fail. Pinned in Task 5.
2. **`pnpm db:dev` run while the dev database is already up:** it should say so and exit 0, not crash on the busy port. Pinned in Task 5.
3. **Missing or malformed environment variables:** the error names each bad variable and never echoes a value. Pinned in Task 8.
4. **A real-looking key in a test fixture or doc:** the secret check must catch keys in any tracked file. The repo's own tests build synthetic keys at runtime so they never contain one literally. Pinned in Task 2.
5. **Several API test files creating databases at the same moment:** cloning must be serialised so no file fails with "source database is being accessed by other users". Pinned in Task 6.

---

### Task 0: Re-sync

**Files:** this plan (edits only).

- [ ] **Step 1:** `git switch -c m00-foundation`
- [ ] **Step 2:** Follow index §6. Nothing is built yet, so for steps 3–4 of §6, confirm instead that `node --version` prints `v24.*`, that `npm view <pkg>@<version> version` resolves every version in index G2 and `embedded-postgres@17.10.0-beta.17`, and that `git status` is clean.
- [ ] **Step 3:** Commit any plan edits (`docs(plan): re-sync m00 with the code as built`).

---

### Task 1: Toolchain pins and repository settings

**Files:**

- Create: `package.json`, `.npmrc`, `.gitattributes`, `.prettierrc.json`, `.prettierignore`, `tsconfig.json`

**Interfaces:**

- Produces: `package.json` scripts `typecheck`, `format`, `format:check`; path alias `@/*` → `src/*`.

- [ ] **Step 1: Write the manifest and settings**
  - `package.json`: `"name": "belikongsi"`, `"private": true`, `"type": "module"`, `"packageManager": "pnpm@10.34.7"`, `"engines": { "node": ">=24 <25" }`, scripts `typecheck` (`tsc --noEmit`), `format` (`prettier --write .`), `format:check` (`prettier --check .`).
  - `.npmrc`: `manage-package-manager-versions=true` and `engine-strict=true`.
  - `.gitattributes`: `* text=auto eol=lf`; `*.png *.jpg *.jpeg *.webp *.pdf binary`.
  - `.prettierrc.json`: `singleQuote: true`, `semi: true`, `printWidth: 100`, `trailingComma: "all"`, `plugins: ["prettier-plugin-tailwindcss"]` (plugin installed in Task 3; add it to the config then).
  - `.prettierignore`: `pnpm-lock.yaml`, `.next`, `src/generated`, `.data`, `docs/superpowers/specs`, `coverage`, `playwright-report`, `test-results`.
  - `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `target: "ES2023"`, `module: "esnext"`, `moduleResolution: "bundler"`, `jsx: "preserve"`, `paths: { "@/*": ["./src/*"] }`, `include` for `src`, `tests`, `scripts`, `prisma`, `*.ts`.
- [ ] **Step 2: Install dev tooling:** `pnpm add -D typescript@~6.0 @types/node@^24 prettier tsx`
- [ ] **Step 3: Verify the pnpm handover.** Run `pnpm --version` in the repo. Expected: `10.34.7`, with the global pnpm 9.10 unchanged (`pnpm --version` outside the repo still prints `9.10.0`). If the handover fails, run every later command as `corepack pnpm@10.34.7 …` and record that in the milestone report.
- [ ] **Step 4: Normalise line endings:** `git add --renormalize .` then `pnpm format:check`. Expected: passes.
- [ ] **Step 5: Commit:** `chore: pin toolchain, line endings and formatting`

---

### Task 2: Secret check and pre-commit hook

**Files:**

- Create: `scripts/lib/secret-patterns.ts`, `scripts/check-secrets.ts`
- Test: `tests/unit/check-secrets.test.ts`
- Modify: `package.json` (`check:secrets` script, `simple-git-hooks` config, `prepare`)

**Interfaces:**

- Produces: `scanText(path: string, content: string): Finding[]`; `isForbiddenPath(path: string): boolean`; `type Finding = { path: string; line: number; kind: SecretKind }`; CLI `tsx scripts/check-secrets.ts --staged | --all` (exit 1 on any finding, printing path, line and kind — never the matched text).

- [ ] **Step 1: Write the failing tests.** Build every synthetic key at runtime, for example `'AIza' + 'A'.repeat(35)`, so this test file never contains a literal key.

```ts
describe('secret check', () => {
  it.each([
    ['google-api-key', () => 'AIza' + 'A'.repeat(35)],
    ['gemini-key', () => 'AQ.' + 'Ab8RN6' + 'x'.repeat(44)],
    ['supabase-pat', () => 'sbp_' + 'a'.repeat(40)],
    ['nvidia-key', () => 'nvapi-' + 'Z'.repeat(64)],
    ['jwt', () => ['eyJ' + 'h'.repeat(20), 'eyJ' + 'p'.repeat(40), 's'.repeat(43)].join('.')],
    ['private-key', () => '-----BEGIN ' + 'PRIVATE KEY-----'],
    [
      'postgres-password',
      () => 'postgresql://postgres:' + 'Hunter2Secret' + '@db.example.com:5432/x',
    ],
  ])('flags a %s', (kind, make) => {
    expect(scanText('docs/x.md', `line one\nvalue=${make()}\n`)).toEqual([
      { path: 'docs/x.md', line: 2, kind },
    ]);
  });
  it('allows placeholder and local-only database passwords', () => {
    for (const pw of ['<password>', 'postgres', 'bk_app_dev', 'bk_app_test', 'e2e']) {
      expect(
        scanText(
          '.env.example',
          'DATABASE_URL=postgresql://bk_app:' + pw + '@localhost:54329/belikongsi',
        ),
      ).toEqual([]);
    }
  });
  it('forbids the key file and env files by name', () => {
    expect(isForbiddenPath('API_Key_Configuration.md')).toBe(true);
    expect(isForbiddenPath('nested/API_Key_Configuration.md')).toBe(true);
    expect(isForbiddenPath('.env.local')).toBe(true);
    expect(isForbiddenPath('.env')).toBe(true);
    expect(isForbiddenPath('.env.example')).toBe(false);
  });
  it('blocks a force-added key file in a real git repository', async () => {
    // temp dir: git init; write API_Key_Configuration.md; git add -f; run the CLI with --staged in that cwd
    // expect exit code 1 and stdout containing "API_Key_Configuration.md" and "forbidden-file"
  });
  it('skips binary files without crashing', () => {
    expect(scanText('a.png', '\u0000\u0001PNG')).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run tests/unit/check-secrets.test.ts`. Expected: FAIL (module not found). If Vitest isn't configured yet, add a bare `vitest.config.ts` with `test.include: ['tests/unit/**/*.test.ts']`; Task 4 replaces it.
- [ ] **Step 3: Implement** `secret-patterns.ts` and `check-secrets.ts`.
  - **Patterns:** Google `/AIza[0-9A-Za-z_\-]{35}/`; Gemini `/AQ\.[0-9A-Za-z_\-]{40,}/`; Supabase PAT `/sbp_[0-9a-f]{40}/`; NVIDIA `/nvapi-[0-9A-Za-z_\-]{40,}/`; JWT `/eyJ[0-9A-Za-z_\-]{10,}\.eyJ[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}/`; private key `/-----BEGIN [A-Z ]*PRIVATE KEY-----/`; Postgres password `/postgres(?:ql)?:\/\/[^:\s/]+:([^@\s]+)@/`, ignored when the password is `<…>`, `postgres`, `bk_app_dev`, `bk_app_test` or `e2e`.
  - **Binary files:** any content containing `\u0000` is skipped.
  - **Modes:** `--staged` reads `git diff --cached --name-only --diff-filter=ACMR` and the staged blob (`git show :<path>`); `--all` reads `git ls-files`.
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5: Wire up the hook.**
  - Run `pnpm add -D simple-git-hooks`.
  - In `package.json`, add `"check:secrets": "tsx scripts/check-secrets.ts"`, `"prepare": "simple-git-hooks"` and `"simple-git-hooks": { "pre-commit": "pnpm check:secrets --staged" }`.
  - Run `pnpm prepare`.
- [ ] **Step 6: Verify the hook blocks for real.** `git add -f API_Key_Configuration.md && git commit -m test`. Expected: the commit is refused, naming `API_Key_Configuration.md` and `forbidden-file`. Then `git restore --staged API_Key_Configuration.md`.
- [ ] **Step 7: Commit:** `chore: add secret check and pre-commit hook`

---

### Task 3: Next.js, Tailwind, shadcn/ui and lint rules

**Files:**

- Create: `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `components.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/lib/utils.ts`, `src/components/ui/button.tsx`, `src/components/ui/card.tsx`
- Modify: `package.json` (`dev`, `build`, `start`, `lint` scripts; dependencies)

**Interfaces:**

- Produces: ESLint rules every later task relies on:
  - `src/server/engine/**` may import only relative paths (R4).
  - `src/server/**` except `src/server/adapters/clock.ts` may not call `Date.now()` or `new Date()` with no arguments (R5).
  - `src/app/api/**` may not import `next/headers` (R1).
  - No `'use server'` directive anywhere (R2).

- [ ] **Step 1: Install.**
  - Runtime: `pnpm add next@~16.4 react@~19.3 react-dom@~19.3`.
  - Dev: `pnpm add -D @types/react@^19 @types/react-dom@^19 tailwindcss@~4.3 @tailwindcss/postcss@~4.3 eslint@^9 eslint-config-next@~16.4 typescript-eslint prettier-plugin-tailwindcss`.
  - Don't run `create-next-app`, because the folder isn't empty.
- [ ] **Step 2: Scaffold.**
  - **Layout:** `layout.tsx` sets `<html lang="en">` and the body font stack, and imports `globals.css` with `@import "tailwindcss";`.
  - **Home page:** `page.tsx` renders an `<h1>BeliKongsi</h1>` and the tagline "Beli sama-sama, harga borong · Buy together, pay wholesale".
  - **shadcn/ui:** run `pnpm dlx shadcn@4 init` (Tailwind v4, base colour neutral, CSS variables, alias `@/components`, utils at `@/lib/utils`), then `pnpm dlx shadcn@4 add button card`.
- [ ] **Step 3: Configure `eslint.config.mjs`.** Use flat config: `eslint-config-next` (core-web-vitals and TypeScript presets) plus these rules:
  - **Engine boundary**, for files `src/server/engine/**`: `no-restricted-imports` with `patterns: [{ regex: '^(?!\\.{1,2}/)', message: 'The Kongsi Engine is pure: only relative imports inside src/server/engine (R4).' }]`.
  - **System time**, for files `src/server/**` with `ignores: ['src/server/adapters/clock.ts']`: `no-restricted-syntax` with `NewExpression[callee.name='Date'][arguments.length=0]` and `CallExpression[callee.object.name='Date'][callee.property.name='now']`, message `'Read time from the Clock (R5).'`.
  - **Route handlers**, for files `src/app/api/**`: `no-restricted-imports` `paths: [{ name: 'next/headers', message: 'Route handlers read the session from the request (R1).' }]`.
  - **No Server Actions**, for files `src/**`: `no-restricted-syntax` `ExpressionStatement > Literal[value='use server']`, message `'No Server Actions (R2).'`.
- [ ] **Step 4: Verify.** Run `pnpm build`, then `pnpm lint`, then `pnpm format:check`. Expected: all three pass, and `next build` lists the route `/`.
- [ ] **Step 5: Commit:** `chore: scaffold Next.js with Tailwind, shadcn/ui and lint rules`

---

### Task 4: Vitest projects and lint-rule tests

**Files:**

- Create: `vitest.config.ts`, `tests/setup/empty-module.ts`, `tests/unit/lint-rules.test.ts`
- Modify: `package.json` (`test`, `test:engine`, `test:api` scripts)

**Interfaces:**

- Produces: the Vitest project `engine` (pure tests: `tests/engine/**`, `tests/unit/**`) and the project `api` (`tests/api/**`, with the global setup from Task 6). Aliases: `@` → `src`; `server-only` → `tests/setup/empty-module.ts`, because the real package throws outside a React Server Components bundle.

- [ ] **Step 1: Write the failing tests.** Use `new ESLint({ cwd })` and `lintText(code, { filePath })` with virtual paths:

```ts
it('stops engine files importing anything outside the engine', async () => {
  const [r] = await eslint.lintText(
    "import { x } from '@/server/platform/db';\nexport const y = x;\n",
    { filePath: 'src/server/engine/probe.ts' },
  );
  expect(r.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
});
it('lets engine files import each other', async () => {
  const [r] = await eslint.lintText("import { a } from './money';\nexport const b = a;\n", {
    filePath: 'src/server/engine/probe.ts',
  });
  expect(r.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
});
it('stops server code reading the system time', async () => {
  const [r] = await eslint.lintText('export const t = Date.now();\n', {
    filePath: 'src/server/modules/probe.ts',
  });
  expect(r.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax');
});
it('lets the clock adapter read the system time', async () => {
  const [r] = await eslint.lintText('export const t = Date.now();\n', {
    filePath: 'src/server/adapters/clock.ts',
  });
  expect(r.messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toEqual([]);
});
it('stops route handlers importing next/headers', async () => {
  const [r] = await eslint.lintText(
    "import { cookies } from 'next/headers';\nexport const c = cookies;\n",
    { filePath: 'src/app/api/probe/route.ts' },
  );
  expect(r.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
});
it('rejects Server Actions', async () => {
  const [r] = await eslint.lintText("'use server';\nexport async function a() {}\n", {
    filePath: 'src/app/probe.ts',
  });
  expect(r.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax');
});
```

- [ ] **Step 2:** Run `pnpm vitest run --project engine`. Expected: FAIL, because the projects don't exist yet.
- [ ] **Step 3: Write `vitest.config.ts`.**
  - Project `engine`: `environment: 'node'`, `include: ['tests/engine/**/*.test.ts', 'tests/unit/**/*.test.ts']`.
  - Project `api`: `include: ['tests/api/**/*.test.ts']`, `pool: 'forks'`, `testTimeout: 30_000`, `hookTimeout: 120_000`.
  - Both use the aliases above.
  - Scripts: `test` (`vitest run`), `test:engine` (`vitest run --project engine`), `test:api` (`vitest run --project api`).
- [ ] **Step 4:** Run `pnpm test:engine`. Expected: PASS for the 6 lint tests and the Task 2 tests.
- [ ] **Step 5: Commit:** `test: add Vitest projects and lint-rule tests`

---

### Task 5: Embedded Postgres for development

**Files:**

- Create: `scripts/lib/embedded-pg.ts`, `scripts/db-dev.ts`
- Test: `tests/api/embedded-pg.test.ts`
- Modify: `package.json` (`db:dev` script, `embedded-postgres` dependency), `.env.example`

**Interfaces:**

- Produces:
  - `startCluster(opts: { dir: string; port: number; password: string; log?: (m: string) => void }): Promise<{ stop(): Promise<void>; adminUrl(db?: string): string }>`. It initialises the cluster when `<dir>/PG_VERSION` is missing, removes a stale `<dir>/postmaster.pid` when nothing listens on the port, and starts it.
  - `isPortListening(port: number): Promise<boolean>`.
  - `ensureDatabase(adminUrl: string, name: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests** (they start real clusters in temporary folders, so they belong in the `api` project):

```ts
it('initialises a new cluster and accepts connections', async () => {
  const c = await startCluster({ dir: tmpDir(), port: 54390, password: 'postgres' });
  expect(await query(c.adminUrl('postgres'), 'select 1 as one')).toEqual([{ one: 1 }]);
  await c.stop();
});
it('restarts after a crash left a stale postmaster.pid', async () => {
  const dir = tmpDir();
  const c1 = await startCluster({ dir, port: 54391, password: 'postgres' });
  await c1.stop();
  writeFileSync(join(dir, 'postmaster.pid'), '99999\n'); // what a crash leaves behind
  const c2 = await startCluster({ dir, port: 54391, password: 'postgres' });
  expect(await isPortListening(54391)).toBe(true);
  await c2.stop();
});
```

- [ ] **Step 2:** Run `pnpm test:api -- embedded-pg`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - Use `new EmbeddedPostgres({ databaseDir, port, user: 'postgres', password, persistent: true, authMethod: 'scram-sha-256', onLog, onError })`, with `.initialise()` only when `PG_VERSION` is missing, then `.start()` and `.stop()`.
  - `isPortListening` uses `node:net` with a 500 ms timeout.
  - `ensureDatabase` runs `CREATE DATABASE` only when `pg_database` has no row for that name.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Write `scripts/db-dev.ts`.**
  - If `isPortListening(54329)`, print `Dev database already running on port 54329.` and exit 0.
  - Otherwise start `.data/pg-dev` on 54329 with password `postgres`, run `ensureDatabase(..., 'belikongsi')`, then print `MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/belikongsi` and `DATABASE_URL=postgresql://bk_app:bk_app_dev@localhost:54329/belikongsi`.
  - Stop the cluster on SIGINT and SIGTERM.
  - Add the script `"db:dev": "tsx scripts/db-dev.ts"`, and add both URLs plus `BK_APP_DB_PASSWORD=bk_app_dev` to `.env.example`.
- [ ] **Step 6: Verify.**
  - Run `pnpm db:dev` in the background. Expected: the URLs are printed and the process stays up.
  - Run `pnpm db:dev` again. Expected: `Dev database already running on port 54329.` and exit code 0.
  - Stop the first process.
- [ ] **Step 7: Commit:** `feat: add embedded Postgres for development`

---

### Task 6: API test harness

**Files:**

- Create: `prisma.config.ts`, `prisma/schema.prisma`, `src/server/platform/db.ts`, `tests/setup/pg-global-setup.ts`, `tests/api/helpers/db.ts`, `tests/api/helpers/route.ts`, `tests/fixtures/routes/echo/[id]/route.ts`
- Test: `tests/api/harness.test.ts`
- Modify: `vitest.config.ts` (`api.globalSetup`), `package.json` (Prisma dependencies, `postinstall: prisma generate`)

**Interfaces:**

- Consumes: `startCluster`, `ensureDatabase` (Task 5).
- Produces:
  - `createPrismaClient(url: string): PrismaClient`.
  - `createTestDatabase(): Promise<{ name: string; adminUrl: string; appUrl: string; drop(): Promise<void> }>`.
  - `callRoute(method: string, path: string, init?: { body?: unknown; headers?: Record<string, string>; routesDir?: string }): Promise<{ status: number; body: any; headers: Headers }>`.
  - Global setup provides (Vitest `provide`): `pgAdminBase` (`postgresql://postgres:postgres@localhost:54330`) and `pgAppCredentials` (`bk_app:bk_app_test`).

- [ ] **Step 1: Write the failing tests:**

```ts
it('gives each caller its own database cloned from the template', async () => {
  const a = await createTestDatabase();
  const b = await createTestDatabase();
  expect(a.name).not.toBe(b.name);
  expect(await query(a.adminUrl, 'select current_database() as db')).toEqual([{ db: a.name }]);
  await a.drop();
  await b.drop();
  expect(await databaseExists(a.name)).toBe(false);
});
it('clones four databases at the same moment without errors', async () => {
  const dbs = await Promise.all([1, 2, 3, 4].map(() => createTestDatabase()));
  expect(new Set(dbs.map((d) => d.name)).size).toBe(4);
  await Promise.all(dbs.map((d) => d.drop()));
});
it('resolves dynamic route folders and passes params', async () => {
  const res = await callRoute('GET', '/echo/abc?x=1', { routesDir: 'tests/fixtures/routes' });
  expect(res).toMatchObject({ status: 200, body: { id: 'abc', x: '1' } });
});
```

- [ ] **Step 2:** Run `pnpm test:api -- harness`. Expected: FAIL.
- [ ] **Step 3: Set up Prisma.**
  - Run `pnpm add @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1 pg` and `pnpm add -D prisma@7.10.1 @types/pg`.
  - **`schema.prisma`:** `generator client { provider = "prisma-client" output = "../src/generated/prisma" }` and `datasource db { provider = "postgresql" }`.
  - **`prisma.config.ts`:** `defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: env('MIGRATION_DATABASE_URL') } })`.
  - **`db.ts`:** `createPrismaClient(url)` returns `new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 5 }) })`.
  - Add the script `"postinstall": "prisma generate"`.
  - In Task 0 of the next milestone, confirm these Prisma 7 APIs against the installed version.
- [ ] **Step 4: Implement the global setup (`pg-global-setup.ts`).**
  1. Start `.data/pg-test` on 54330 with `startCluster`.
  2. Hash `prisma/migrations/**` with SHA-256.
  3. If `bk_template` is missing, or `shobj_description` of `bk_template` differs from the hash, drop it, create it, run `prisma migrate deploy` with `MIGRATION_DATABASE_URL` set to it, and run `COMMENT ON DATABASE bk_template IS '<hash>'`.
  4. Create the role `bk_app` NOLOGIN if it's still missing (before Task 7 there are no migrations to create it), then run `ALTER ROLE bk_app WITH LOGIN PASSWORD 'bk_app_test'`. This is what `db:setup-role` does on other databases.
  5. Close every connection to `bk_template`.
  6. Provide the values above.
  7. Teardown stops the cluster.
- [ ] **Step 5: Implement `createTestDatabase`.** Serialise cloning with `pg_advisory_lock(424242)` on an admin connection, then `CREATE DATABASE "t_<8 hex>" TEMPLATE bk_template`, then unlock. `drop()` runs `DROP DATABASE … WITH (FORCE)`.
- [ ] **Step 6: Implement `callRoute`.**
  - Glob `<routesDir ?? 'src/app/api'>/**/route.ts` once.
  - Turn each folder path into a regex: `[name]` becomes a named group and `[...name]` a catch-all.
  - For the matching file, call its exported `method` with `new Request('http://localhost' + path, …)` and `{ params: Promise.resolve(params) }`.
  - Parse JSON bodies; leave others as text.
- [ ] **Step 7:** Run the tests again. Expected: PASS.
- [ ] **Step 8: Commit:** `test: add per-file test databases and a route caller`

---

### Task 7: Baseline migration, app role and security tests

**Files:**

- Create: `prisma/migrations/<timestamp>_baseline/migration.sql`, `scripts/db-setup-role.ts`
- Test: `tests/api/security-baseline.test.ts`
- Modify: `package.json` (`db:migrate`, `db:setup-role`, `db:reset` scripts)

**Interfaces:**

- Produces:
  - SQL function `bk_secure_all_tables()`, which every later migration calls last.
  - Role `bk_app` (NOLOGIN until `db:setup-role` runs).
  - Roles `anon` and `authenticated` (created when missing).
  - `pnpm db:setup-role`, which reads `MIGRATION_DATABASE_URL` and `BK_APP_DB_PASSWORD`.

- [ ] **Step 1: Write the failing tests** (each one uses `createTestDatabase()`; "admin" means the `postgres` connection):

```ts
it('creates the roles it needs', async () => {
  expect(
    await query(
      admin,
      "select rolname from pg_roles where rolname in ('bk_app', 'anon', 'authenticated') order by rolname",
    ),
  ).toEqual([{ rolname: 'anon' }, { rolname: 'authenticated' }, { rolname: 'bk_app' }]);
});
it('secures tables created by later migrations', async () => {
  await exec(admin, 'create table widgets (id int primary key); select bk_secure_all_tables();');
  expect(
    await query(admin, "select relrowsecurity from pg_class where relname = 'widgets'"),
  ).toEqual([{ relrowsecurity: true }]);
  await expect(exec(admin, 'set role anon; select * from widgets')).rejects.toThrow(
    /permission denied/,
  );
  await expect(exec(admin, 'set role authenticated; select * from widgets')).rejects.toThrow(
    /permission denied/,
  );
});
it('lets the app role read, insert, update and delete ordinary tables', async () => {
  // as admin: create table widgets(...); select bk_secure_all_tables();
  // as admin: set role bk_app; insert, update, delete one row → no error
});
it('makes the log and ledger tables append-only for the app role', async () => {
  // as admin: create table activity_log_entries (seq bigint primary key); create table ledger_postings (id int primary key); select bk_secure_all_tables();
  // as bk_app: insert works; update → /permission denied/; delete → /permission denied/; truncate → /permission denied/
});
it('never grants TRUNCATE to the app role', async () => {
  expect(
    await query(
      admin,
      "select count(*)::int as n from information_schema.table_privileges where grantee = 'bk_app' and privilege_type = 'TRUNCATE'",
    ),
  ).toEqual([{ n: 0 }]);
});
```

- [ ] **Step 2:** Run `pnpm test:api -- security-baseline`. Expected: FAIL.
- [ ] **Step 3: Create the migration.** Run `pnpm prisma migrate dev --create-only --name baseline` against the dev database, then write its SQL:
  - `DO` blocks that create the roles `bk_app`, `anon` and `authenticated` (all NOLOGIN) only when missing.
  - `GRANT USAGE ON SCHEMA public TO bk_app;`.
  - `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;` (without `FOR ROLE` it applies to the role running migrations: `postgres` everywhere), and the same for sequences and functions.
  - `CREATE OR REPLACE FUNCTION bk_secure_all_tables() RETURNS void`. For every `pg_tables` row in `public`:
    - `ENABLE ROW LEVEL SECURITY`.
    - Unless the table is `_prisma_migrations`: drop and recreate the policy `bk_app_all FOR ALL TO bk_app USING (true) WITH CHECK (true)`.
    - `REVOKE ALL … FROM anon, authenticated, bk_app`.
    - Then grant `SELECT, INSERT` for `activity_log_entries` and `ledger_postings`, `SELECT, INSERT, UPDATE, DELETE` for every other table except `_prisma_migrations`, and finally `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bk_app`.
  - The last line: `SELECT bk_secure_all_tables();`.
- [ ] **Step 4: Implement `db-setup-role.ts`.** `ALTER ROLE bk_app WITH LOGIN PASSWORD <escapeLiteral(BK_APP_DB_PASSWORD)>`. Refuse an empty password, and never print it.
  - Scripts: `"db:migrate": "prisma migrate dev"`, `"db:setup-role": "tsx scripts/db-setup-role.ts"`, `"db:reset": "prisma migrate reset --force && pnpm db:setup-role"` (M2 appends `&& pnpm db:seed`). Prisma 7.10.1 rejects `--skip-seed` and no longer seeds on reset, so the flag is omitted.
- [ ] **Step 5:** Run the tests again. Expected: PASS. The global setup rebuilds the template because the migrations hash changed.
- [ ] **Step 6: Verify on the dev database.** Run `pnpm db:reset`. Expected: it ends with `bk_app` able to log in. Check with `select current_user` as `bk_app` on 54329.
- [ ] **Step 7: Commit:** `feat: add baseline migration with app role and row-level security`

---

### Task 8: Environment, errors, route wrapper and health endpoint

**Files:**

- Create: `src/server/platform/env.ts`, `src/server/platform/errors.ts`, `src/server/platform/http.ts`, `src/server/platform/deps.ts`, `src/app/api/health/route.ts`
- Test: `tests/unit/env.test.ts`, `tests/unit/errors.test.ts`, `tests/api/health.test.ts`

**Interfaces:**

- Produces:
  - `getServerEnv(source = process.env): ServerEnv`, where `ServerEnv = { DATABASE_URL: string; SESSION_SECRET: string; CRON_SECRET: string; DEMO_MODE: boolean; AI_ADAPTER: 'gemini' | 'fake'; GEMINI_API_KEY?: string; GEMINI_MODEL: string; STORAGE_ADAPTER: 'local' | 'supabase'; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }`.
    - Defaults: `DEMO_MODE` true, `AI_ADAPTER` `'fake'`, `GEMINI_MODEL` `'gemini-3.5-flash-lite'` (until D6 decides), `STORAGE_ADAPTER` `'local'`.
    - `SESSION_SECRET` needs at least 32 characters and `CRON_SECRET` at least 16.
    - `GEMINI_API_KEY` is required when `AI_ADAPTER=gemini`; the Supabase pair when `STORAGE_ADAPTER=supabase`.
  - `class AppError extends Error { code: string; status: 400|401|403|404|409|422|429|503; details?: unknown }` and helpers `badRequest(message, details?)`, `unauthorized()`, `forbidden(message?)`, `notFound(what)`, `conflict(code, message)`, `unprocessable(code, message, details?)`, `rateLimited()`, `aiUnavailable()`, plus `toErrorResponse(error: unknown): Response`. Unknown errors become 500 `{ code: 'INTERNAL', message: 'Something went wrong.' }`, with the cause logged on the server only.
  - `json(data: unknown, init?: ResponseInit): Response`.
  - `route<TBody = unknown, TQuery = unknown>(options: { auth: 'public'; body?: ZodType<TBody>; query?: ZodType<TQuery> }, handler: (args: { request: Request; deps: AppDeps; params: Record<string, string>; body: TBody; query: TQuery }) => Promise<Response>)`. It returns a Next route handler. M2 extends `auth` to sessions and roles. A Zod failure gives 400 `{ code: 'INVALID_INPUT', details: { fieldErrors } }`.
  - `interface AppDeps { prisma: PrismaClient; env: ServerEnv }` (M2 onward adds `clock`, M3 `logistics`/`ai`/`storage`, M4 `payments`), plus `getDeps(): AppDeps` (lazy singleton) and `setDepsForTests(deps: AppDeps | null): void`.
- Consumes: `createPrismaClient` (Task 6), `callRoute`, `createTestDatabase` (Task 6).

- [ ] **Step 1: Write the failing tests:**

```ts
// tests/unit/env.test.ts
it('names every missing variable and never echoes values', () => {
  expect(() => getServerEnv({ SESSION_SECRET: 'short-secret-value', CRON_SECRET: 'x' })).toThrow(
    /DATABASE_URL.*SESSION_SECRET.*CRON_SECRET/s,
  );
  try {
    getServerEnv({ SESSION_SECRET: 'short-secret-value' });
  } catch (e) {
    expect(String(e)).not.toContain('short-secret-value');
  }
});
it('requires the Gemini key only when the Gemini adapter is chosen', () => {
  expect(() => getServerEnv({ ...valid, AI_ADAPTER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
  expect(getServerEnv({ ...valid, AI_ADAPTER: 'fake' }).AI_ADAPTER).toBe('fake');
});
// tests/unit/errors.test.ts
it('turns an AppError into the one error shape', async () => {
  const res = toErrorResponse(conflict('ROUND_CLOSED', 'This round has already closed.'));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    code: 'ROUND_CLOSED',
    message: 'This round has already closed.',
  });
});
it('hides unexpected errors behind a 500', async () => {
  const res = toErrorResponse(new Error('db password is hunter2'));
  expect(res.status).toBe(500);
  expect(await res.text()).not.toContain('hunter2');
});
// tests/api/health.test.ts
it('reports ok when the database answers as the app role', async () => {
  const db = await createTestDatabase();
  setDepsForTests(depsFor(db.appUrl));
  expect(await callRoute('GET', '/api/health')).toMatchObject({
    status: 200,
    body: { status: 'ok', database: 'ok' },
  });
});
it('reports the database as unreachable without leaking the URL', async () => {
  setDepsForTests(depsFor('postgresql://bk_app:bk_app_test@localhost:1/nowhere'));
  const res = await callRoute('GET', '/api/health');
  expect(res).toMatchObject({ status: 503, body: { status: 'degraded', database: 'unreachable' } });
  expect(JSON.stringify(res.body)).not.toContain('bk_app_test');
});
```

- [ ] **Step 2:** Run `pnpm test:engine -- env errors` and `pnpm test:api -- health`. Expected: FAIL.
- [ ] **Step 3: Implement** the four platform files and `GET /api/health`, which uses `route({ auth: 'public' })` and runs `SELECT 1` through `deps.prisma.$queryRaw` with a 2-second timeout.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Verify against the dev database.** With `pnpm db:dev` running and `.env.local` copied from `.env.example`, run `pnpm dev` and `curl localhost:3000/api/health`. Expected: `{"status":"ok","database":"ok"}`.
- [ ] **Step 6: Commit:** `feat: add env validation, error shape, route wrapper and health endpoint`

---

### Task 9: Playwright configuration

**Files:**

- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts` (M10 replaces it with `demo.spec.ts`)
- Modify: `package.json` (`e2e` script)

- [ ] **Step 1: Write the failing test:** `test('home page shows the product name', …)` opens `/` and expects `getByRole('heading', { name: 'BeliKongsi' })` to be visible.
- [ ] **Step 2: Configure Playwright.**
  - Install: `pnpm add -D @playwright/test@~1.64` and `pnpm exec playwright install chromium`.
  - Config: `use.baseURL = process.env.BASE_URL ?? 'http://localhost:3100'`; project `phone` with `viewport: { width: 390, height: 844 }`.
  - `webServer`, only when `BASE_URL` is unset: `{ command: 'pnpm build && pnpm start -p 3100', port: 3100, reuseExistingServer: !process.env.CI, timeout: 240_000 }`.
  - Script: `"e2e": "playwright test"`.
- [ ] **Step 3:** Run `pnpm e2e`. Expected: 1 passed.
- [ ] **Step 4: Commit:** `test: add Playwright at phone size`

---

### Task 10: CI workflow and `pnpm verify`

**Files:**

- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (`verify` script)

- [ ] **Step 1: Add the `verify` script.** `"verify": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm check:secrets --all && pnpm test && pnpm build"`.
- [ ] **Step 2: Write `ci.yml`.**
  - **Triggers:** `push` and `pull_request`.
  - **Job `checks`** on `ubuntu-latest`: `actions/checkout`, `pnpm/action-setup` (version taken from `packageManager`), `actions/setup-node` (24, cache `pnpm`), `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm check:secrets --all`, `FC_NUM_RUNS=5000 pnpm test:engine`, `pnpm test:api`.
  - **Job `e2e`** with `if: github.ref == 'refs/heads/main'`, needing `checks`: the same setup, then `pnpm exec playwright install --with-deps chromium` and `pnpm e2e`.
  - No `services:` and no containers (G1).
- [ ] **Step 3: Verify.** Run `pnpm verify`. Expected: every step passes. Without a remote, CI can't run here; the milestone report says so.
- [ ] **Step 4: Commit:** `ci: add GitHub Actions workflow and pnpm verify`

---

### Task 11: Docs skeletons and the Supabase pooler settings

**Files:**

- Create: `README.md`, `docs/deployment.md`
- Modify: `.env.example` (every variable from build design §5.5, with placeholder values)

- [ ] **Step 1: Read the pooler settings** (read-only, D4). Run `GET https://api.supabase.com/v1/projects/iwzctxxwotcgejswdlfz/config/database/pooler` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. The token is set only for that one command, from the key file, and never written anywhere. Record `db_host`, `db_port` and `pool_mode` for transaction and session mode.
- [ ] **Step 2: Write the docs.**
  - **`README.md`:** the title, the tagline, a status line, a local-setup section (`pnpm install`, `pnpm db:dev`, `pnpm db:reset`, `pnpm dev`) and the scripts table from index §3.
  - **`docs/deployment.md`:** the section headings from build design §7, the connection-string shapes with `<password>` placeholders built from the recorded hosts (user `bk_app.iwzctxxwotcgejswdlfz` on 6543; `postgres.iwzctxxwotcgejswdlfz` on 5432), and the §5.1 fallback paragraph.
  - **`.env.example`:** every §5.5 name. Local values: `AI_ADAPTER=fake`, `STORAGE_ADAPTER=local`, `DEMO_MODE=true`, dev URLs from Task 5. Everything else uses `<placeholder>` values.
- [ ] **Step 3: Verify.** Run `pnpm check:secrets --all` and `pnpm format:check`. Expected: both pass.
- [ ] **Step 4: Commit:** `docs: add README, deployment guide skeleton and env example`

---

### Milestone verification

- [ ] Run `pnpm verify`. Expected: format, lint, typecheck, the secret check, both test projects and the build all pass.
- [ ] Run `pnpm e2e`. Expected: 1 passed.
- [ ] Merge: `git switch main && git merge --ff-only m00-foundation`. Post the milestone report (index §6).
