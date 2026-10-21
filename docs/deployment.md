# Deployment guide

The deployment kit is delivered in M10 and run by you. This page is a skeleton: the connection strings are final, and the steps are filled in as the scripts are built.

## Steps

1. Create the public repository and switch on secret scanning and push protection.
2. Import it into Vercel and set the production-only environment variables.
3. Run the Supabase steps below.
4. Restrict the Maps key.
5. Rotate the keys and the database password.
6. Run the pre-demo checklist from the PRD's Testing Decisions.

## Vercel

`vercel.json` (M10) sets a daily cron that calls `/api/jobs/run`, runs functions in `sin1` (Singapore, beside the database) and deploys from `main` only, so previews never touch the demo data.

Set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_ADAPTER`, `STORAGE_ADAPTER`, `SESSION_SECRET`, `CRON_SECRET`, `DEMO_MODE` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Never set `MIGRATION_DATABASE_URL`, `BK_APP_DB_PASSWORD`, `NVIDIA_API_KEY` or `SUPABASE_ACCESS_TOKEN` on Vercel: they stay on your machine.

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

## Supabase steps

Scripts arrive in M10.

- `pnpm prod:migrate`: `prisma migrate deploy` through `MIGRATION_DATABASE_URL`.
- `pnpm prod:setup-role`: enables `bk_app` login with its password.
- `pnpm prod:storage`: creates the buckets and uploads the product images.
- `pnpm prod:check`: connects as `bk_app` through the pooler, confirms row-level security on every table and the append-only triggers, and runs Supabase's security advisor.

Seeding is "Reset demo data" in the deployed app.

## Fallback if bk_app cannot log in through the pooler

`pnpm prod:check` tests this during your deploy. If `bk_app` can't log in through the pooler, the app uses the `postgres` role instead: set `DATABASE_URL` to the `postgres.iwzctxxwotcgejswdlfz` string above, on port 6543. Table ownership then bypasses row-level security, and the append-only triggers still apply.

## Cron

Vercel sends `Authorization: Bearer $CRON_SECRET`, and the endpoint rejects anything else. The daily call also keeps the free Supabase project from pausing, which happens after 7 idle days.

## Rotate keys

Rotate the API keys and the database password after the demo setup (step 5).
