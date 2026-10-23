import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': resolve(import.meta.dirname, 'src'),
  // The real `server-only` package throws outside an RSC bundle, so tests get an empty module.
  'server-only': resolve(import.meta.dirname, 'tests/setup/empty-module.ts'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'engine',
          environment: 'node',
          sequence: { groupOrder: 1 },
          include: ['tests/engine/**/*.test.ts', 'tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          // The reset timing test runs alone in `api-serial`, where parallel forks cannot slow it.
          exclude: ['tests/api/**/*.serial.test.ts'],
          pool: 'forks',
          // CREATE DATABASE ... TEMPLATE serialises cluster-wide; many parallel forks starve it.
          maxWorkers: 4,
          // Projects with different maxWorkers need distinct groups.
          sequence: { groupOrder: 2 },
          testTimeout: 30_000,
          hookTimeout: 120_000,
          globalSetup: ['tests/setup/pg-global-setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'api-serial',
          include: ['tests/api/**/*.serial.test.ts'],
          pool: 'forks',
          // One worker, and a later group than `api`, so it starts after the parallel forks finish.
          maxWorkers: 1,
          sequence: { groupOrder: 3 },
          testTimeout: 30_000,
          hookTimeout: 120_000,
          globalSetup: ['tests/setup/pg-global-setup.ts'],
        },
      },
    ],
  },
});
