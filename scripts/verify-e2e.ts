/**
 * The end-to-end step of `pnpm verify`. Verify has just built the app, so the server skips its own
 * build (SKIP_BUILD=1), and it never reuses a server already on port 3100 (E2E_FRESH_SERVER=1,
 * read by playwright.config.ts), which could be an older build. Plain `pnpm e2e` is unchanged.
 * A wrapper rather than `VAR=x cmd` in package.json, which cmd.exe on Windows cannot run.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, E2E_FRESH_SERVER: '1', SKIP_BUILD: '1' },
});
process.exit(result.status ?? 1);
