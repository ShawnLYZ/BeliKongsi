import { defineConfig } from '@playwright/test';

const LOCAL_URL = 'http://localhost:3100';
const HEALTH_URL = `${LOCAL_URL}/api/health`;

/** True when something on port 3100 answers /api/health with 200 (the app, database up). */
async function healthyLocalServer(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

// A stray server on port 3100 is reused only when it passes the health probe, and never in CI.
// `pnpm verify` sets E2E_FRESH_SERVER=1 so it never tests an older build left running.
// Otherwise Playwright starts scripts/e2e-server.ts, which fails with a clear message when the
// port is taken (and Playwright itself refuses a port that already answers the probe).
const reuseExistingServer =
  !process.env.CI && !process.env.BASE_URL && !process.env.E2E_FRESH_SERVER
    ? await healthyLocalServer()
    : false;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: process.env.BASE_URL ?? LOCAL_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'tsx scripts/e2e-server.ts',
        url: HEALTH_URL,
        reuseExistingServer,
        // A full run builds the app first.
        timeout: 600_000,
        stdout: 'pipe',
        // Lets the server stop Postgres itself on Linux and macOS (Windows force-kills; the
        // server's watchdog covers that).
        gracefulShutdown: { signal: 'SIGTERM', timeout: 60_000 },
      },
});
