# Deployment guide

You run every step on this page; nothing here is run for you. Real values go into the Vercel dashboard or into your shell for one command. They never go into a file that git tracks.

Replace `<owner>/<repo>` with your GitHub repository and `<ref>` with the Supabase project ref (the part before `.supabase.co`).

## Steps at a glance

1. Create the public repository and switch on secret scanning and push protection.
2. Import it into Vercel and set the production-only environment variables.
3. Run the Supabase steps (migrate, role, storage, check).
4. Restrict the Maps key.
5. Rotate the keys and the database password.
6. Run the pre-demo checklist.

## 1. Repository and secret scanning

Create the public repository and push `main`. Then switch on secret scanning and push protection:

```
gh api -X PATCH repos/<owner>/<repo> -f "security_and_analysis[secret_scanning][status]=enabled" -f "security_and_analysis[secret_scanning_push_protection][status]=enabled"
```

Expected: JSON for the repository, with `"secret_scanning": { "status": "enabled" }` and `"secret_scanning_push_protection": { "status": "enabled" }` under `security_and_analysis`.

If it fails: a 403 or 404 means `gh` is not signed in as an owner or admin of the repository (`gh auth status`). If the fields are missing from the answer, switch both on under Settings, then Code security, in the GitHub web page.

## 2. Vercel

1. Import the repository into Vercel (Framework Preset: Next.js).
2. Set `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses pnpm 10.34.7 from `package.json`.
3. Set the environment variables below, for the Production environment.

`vercel.json` already sets:

- a daily cron on `/api/jobs/run` at `0 22 * * *` UTC, which is 06:00 in Malaysia, so the Monday cron drafts baskets on time;
- functions in `sin1` (Singapore, beside the database);
- deployments from `main` only (`"**": false` stops every other branch, including branches with a `/` in the name), so previews never touch the demo data.

### Vercel environment variables (production only)

| Name                              | Secret                 | Notes                                                            |
| --------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`                    | yes                    | pooler, transaction mode, port 6543, role `bk_app` (see below)   |
| `SUPABASE_URL`                    | no                     | `https://<ref>.supabase.co`                                      |
| `SUPABASE_SERVICE_ROLE_KEY`       | yes                    | Storage access, server only                                      |
| `GEMINI_API_KEY`                  | yes                    | needed when `AI_ADAPTER=gemini`                                  |
| `GEMINI_MODEL`                    | no                     | `gemini-3.5-flash-lite`                                          |
| `AI_ADAPTER`                      | no                     | `gemini`                                                         |
| `STORAGE_ADAPTER`                 | no                     | `supabase`                                                       |
| `SESSION_SECRET`                  | yes                    | at least 32 random characters                                    |
| `CRON_SECRET`                     | yes                    | at least 16 random characters; Vercel sends it to the cron call  |
| `DEMO_MODE`                       | no                     | `true`                                                           |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | restricted browser key | the only value sent to the browser (step 4)                      |
| `ENABLE_EXPERIMENTAL_COREPACK`    | no                     | `1`                                                              |
| `LOCAL_STORAGE_DIR`               | no                     | leave unset in production (only used by `STORAGE_ADAPTER=local`) |

Generate the two secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Never set `MIGRATION_DATABASE_URL`, `BK_APP_DB_PASSWORD`, `NVIDIA_API_KEY` or `SUPABASE_ACCESS_TOKEN` on Vercel: they stay on your machine.

On Vercel, `AI_ADAPTER` and `STORAGE_ADAPTER` must be set explicitly, to `gemini` and `supabase`: they have local-development defaults (fake AI, local storage) that a deployed demo must not fall back to. A deployment that is missing a variable, or has either of these wrong, fails at start-up with `Invalid environment configuration: <NAME> (<reason>), ...`. The message names the variable and never prints a value. Open the deployment's runtime logs, set the named variable and redeploy. `.env.example` lists every variable the server reads.

## Connection strings

Percent-encode the password if it contains special characters.

App at runtime (`DATABASE_URL`), pooler in transaction mode, port 6543, role `bk_app`:

```
postgresql://bk_app.iwzctxxwotcgejswdlfz:<password>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

Migrations (`MIGRATION_DATABASE_URL`), pooler in session mode, port 5432, role `postgres`. This works over IPv4; the direct database host is IPv6-only:

```
postgresql://postgres.iwzctxxwotcgejswdlfz:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

## 3. Supabase steps

Run these on your machine. Put the values in your shell for the session (do not save them to a tracked file), for example in PowerShell:

```
$env:MIGRATION_DATABASE_URL = "<migration connection string>"
$env:BK_APP_DB_PASSWORD = "<new random password for bk_app>"
$env:DATABASE_URL = "<app connection string, using the same password>"
$env:SUPABASE_URL = "https://<ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
$env:SUPABASE_ACCESS_TOKEN = "<personal access token>"   # optional, only for the advisor
```

The `prod:*` scripts read only the variables set in your shell. They never take values from `.env.local` or `.env`, because those hold the local dev values (the Prisma process that `prod:migrate` starts does load them, but values set in your shell win, and the script has already checked that `MIGRATION_DATABASE_URL` is set). Each script stops at once and names the missing variable if one is not set. `prod:migrate` and `prod:setup-role` also refuse a `MIGRATION_DATABASE_URL` that points at this machine. `prod:check` starts by printing the host and database it is checking (never the password), so confirm it is the production one; it still runs against a local database when you set the URLs yourself. None of them prints a secret.

### 3.1 Migrate

```
pnpm prod:migrate
```

Expected: `5 migrations found in prisma/migrations`, then `All migrations have been successfully applied.` (or `No pending migrations to apply.` on a repeat run).

If it fails: `Can't reach database server` means the connection string, the pooler port (5432, session mode) or the password is wrong. A `P3009` or `P3018` error means an earlier run stopped half way; read the message, fix the cause and run `prisma migrate resolve` as it describes.

### 3.2 Let `bk_app` log in

```
pnpm prod:setup-role
```

Expected: `Role bk_app can now log in.`

If it fails: `role "bk_app" does not exist` means step 3.1 did not finish. A blank or missing `BK_APP_DB_PASSWORD` is refused.

### 3.3 Storage

```
pnpm prod:storage
```

Expected: `Bucket product-images: created`, `Bucket delivery-photos: created` (or `already exists`), then `Uploaded 12 product images to product-images.` The `product-images` bucket is public. `delivery-photos` is private, accepts `image/jpeg`, `image/png` and `image/webp`, and limits files to 5 MB. Re-running is safe: existing buckets are left alone and the images are uploaded again with upsert.

If it fails: `Invalid API key` or a 401 means `SUPABASE_SERVICE_ROLE_KEY` is wrong or from another project; a network error means `SUPABASE_URL` is wrong.

### 3.4 Check the security baseline

```
pnpm prod:check
```

Expected: a table of `PASS` lines and `8 passed (0 with warnings), 0 failed.` With `SUPABASE_ACCESS_TOKEN` set it adds a `supabase_advisor` line. The command exits 1 on any `FAIL`.

| Check                  | What it proves                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_role`             | `DATABASE_URL` connects as `bk_app` (a `postgres` login is a warning, see the fallback below)                                                                                                            |
| `rls_enabled`          | row-level security is on for every table in `public`, including `_prisma_migrations`                                                                                                                     |
| `bk_app_policy`        | every app table has the `bk_app_all` policy (`_prisma_migrations` deliberately has none)                                                                                                                 |
| `no_anon_access`       | `anon` and `authenticated` cannot `SELECT` from any table                                                                                                                                                |
| `append_only_triggers` | `activity_log_entries` and `ledger_postings` reject updates and deletes                                                                                                                                  |
| `no_truncate`          | `bk_app` has no `TRUNCATE` right on any table                                                                                                                                                            |
| `demo_reset_definer`   | `bk_demo_reset()` is `SECURITY DEFINER`, so "Reset demo data" needs no `TRUNCATE` right                                                                                                                  |
| `demo_settings_locked` | `bk_app` cannot `INSERT`, `DELETE` or `TRUNCATE` `demo_settings` or update its `demo_mode` column, so it cannot switch demo mode off                                                                     |
| `supabase_advisor`     | (token set) `ERROR` lints fail; `WARN` lints and unknown levels warn; an advisor that is unreachable (HTTP 401, 403, 404, 429 or a network error) warns, and you check the Security Advisor page by hand |

If a check fails: `rls_enabled`, `bk_app_policy`, `no_anon_access` and `no_truncate` mean a table or grant was changed by hand; run this as `postgres` and run the check again. `bk_secure_all_tables()` grants `bk_app` full rights on every table, so the second statement takes the `demo_settings` rights back (the same two lines the latest migration ends with); never run the first statement alone. `demo_settings_locked` is fixed by the same snippet.

```sql
select bk_secure_all_tables();
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "demo_settings" FROM bk_app;
GRANT UPDATE ("clock_offset_ms", "seed_version", "last_reset_at", "featured_product_id") ON "demo_settings" TO bk_app;
```

`append_only_triggers` or `demo_reset_definer` mean the object was dropped or altered by hand, so `prisma migrate deploy` (step 3.1) will say "No pending migrations" and change nothing. Run the SQL that creates it again as `postgres`: the `activity_log_entries_append_only` and `ledger_postings_append_only` triggers are in `prisma/migrations/20261022063500_p0_schema/migration.sql`, and `bk_demo_reset()` is in the same file. An `app_role` failure that says the connection failed is the fallback case below.

### Fallback if `bk_app` cannot log in through the pooler

If `pnpm prod:check` reports `app_role` as a failure because `bk_app` cannot log in through the pooler, the app can use the `postgres` role instead: set `DATABASE_URL` to the `postgres.iwzctxxwotcgejswdlfz` string above, on port 6543.

`pnpm prod:check` then shows a warning, not a pass:

```
WARN  app_role  fallback mode: the app connects as postgres. Table ownership bypasses row-level security; ...
```

In fallback mode, table ownership bypasses row-level security, and only the append-only triggers still protect the activity log and the ledger. The other checks still describe the database itself. Move back to `bk_app` as soon as it can log in.

### Seeding

Seeding is "Reset demo data" in the deployed app (sign in as the presenter in demo mode). It runs `bk_demo_reset()` and loads the demo data, with no script and no database tool.

## Cron

Vercel sends `Authorization: Bearer $CRON_SECRET`, and the endpoint rejects anything else. The daily call also keeps the free Supabase project from pausing, which happens after 7 idle days.

## 4. Restrict the Maps key

In the Google Cloud console, open the key used for `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`:

- Application restrictions: HTTP referrers, with the production domain (for example `https://<your-app>.vercel.app/*`) and `http://localhost:3000/*`.
- API restrictions: Maps JavaScript API only.

Expected: the map loads on the deployed site and on localhost, and a request from any other site is refused.

If the map shows "This page can't load Google Maps correctly": the referrer does not match the exact domain you restricted to, or the Maps JavaScript API is not enabled for the project.

## 5. Rotate the keys

Rotate after the demo setup works, because the key file's contents were shared in the AI chat used to design this build:

- the database password (random, long), then update `BK_APP_DB_PASSWORD`, `DATABASE_URL` and `MIGRATION_DATABASE_URL` and run `pnpm prod:setup-role` again;
- the Supabase service role key and your Supabase personal access token;
- the Gemini key and the NVIDIA key;
- the Maps key (create a new restricted key, then delete the old one);
- `SESSION_SECRET` and `CRON_SECRET`.

After you change a Vercel variable, redeploy. Then run `pnpm prod:check` again.

## 6. Pre-demo checklist

Before every demo:

1. Run the AI accuracy set: `pnpm ai:accuracy` (needs `GEMINI_API_KEY`).
2. Run the end-to-end test against the deployed URL: `BASE_URL=https://<your-app>.vercel.app pnpm e2e` (on PowerShell, set `$env:BASE_URL` first).
3. Press "Reset demo data" in the deployed app.
4. "Verify log" shows ✅.
5. The money overview shows ✅.

Also run `pnpm prod:check` after any change to the database or to the Vercel variables.
