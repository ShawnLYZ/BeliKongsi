# BeliKongsi

Beli sama-sama, harga borong · Buy together, pay wholesale

**Status:** M0 (foundation) is done: the Next.js app, environment validation, error shape, route wrapper, health endpoint, database security baseline, test setup and CI. Features arrive in later milestones.

## Local setup

1. Install packages: `pnpm install`
2. Copy `.env.example` to `.env.local`, then generate real values for `SESSION_SECRET` and `CRON_SECRET`:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. Start the dev Postgres (port 54329): `pnpm db:dev`. It keeps running in the foreground, so leave that terminal open and do the next steps in a second terminal.
4. Create the schema and enable the `bk_app` login: `pnpm db:reset`
5. Start the app on port 3000: `pnpm dev`

The Supabase, Gemini and Maps `<placeholder>` values in `.env.local` can stay as they are for local development (`AI_ADAPTER=fake`, `STORAGE_ADAPTER=local`).

Production setup is in [docs/deployment.md](docs/deployment.md).

## Scripts

The last column shows the milestone that adds each script, so scripts not built yet are marked.

| Script                                                                  | Does                                                                                 | Milestone                                  |
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
