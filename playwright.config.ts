import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3100',
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
        command: 'pnpm build && pnpm start -p 3100',
        port: 3100,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
