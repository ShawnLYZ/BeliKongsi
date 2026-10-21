import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const noServerActions = {
  selector: "ExpressionStatement > Literal[value='use server']",
  message: 'No Server Actions (R2).',
};

const noSystemTime = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Read time from the Clock (R5).',
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: 'Read time from the Clock (R5).',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Read time from the Clock (R5).',
  },
];

const nextHeadersBan = {
  name: 'next/headers',
  message: 'Read the session from the request; next/headers is only for session-page.ts (R1).',
};

const noDynamicImport = {
  selector: 'ImportExpression',
  message: 'The Kongsi Engine is pure: no dynamic imports (R4).',
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'src/generated/**',
    '.superpowers/**',
    'next-env.d.ts',
  ]),
  {
    // R2: applies to all of src/**. Later blocks that set no-restricted-syntax for overlapping
    // files replace this option list, so they must repeat noServerActions.
    files: ['src/**/*.{ts,tsx,js,jsx,mjs}'],
    rules: { 'no-restricted-syntax': ['error', noServerActions] },
  },
  {
    // R5: system time is banned in src/server/**, src/app/** and src/lib/** except the clock
    // adapter, plus R2 (this block replaces the one above for these files).
    files: [
      'src/server/**/*.{ts,tsx,js,jsx,mjs}',
      'src/app/**/*.{ts,tsx,js,jsx,mjs}',
      'src/lib/**/*.{ts,tsx,js,jsx,mjs}',
    ],
    ignores: ['src/server/adapters/clock.ts'],
    rules: { 'no-restricted-syntax': ['error', ...noSystemTime, noServerActions] },
  },
  {
    // R1: next/headers is only allowed in the session page helper (M2). Engine files repeat
    // this path in their own no-restricted-imports option below.
    files: ['src/server/**/*.{ts,tsx,js,jsx,mjs}'],
    ignores: ['src/server/platform/session-page.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [nextHeadersBan] }] },
  },
  {
    // R4: the Kongsi Engine is pure. Engine files are also covered by the blocks above, so this
    // block carries every no-restricted-syntax selector and every no-restricted-imports entry.
    files: ['src/server/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...noSystemTime, noServerActions, noDynamicImport],
      'no-restricted-imports': [
        'error',
        {
          paths: [nextHeadersBan],
          patterns: [
            {
              regex: String.raw`^(?!\.{1,2}/)`,
              message:
                'The Kongsi Engine is pure: only relative imports inside src/server/engine (R4).',
            },
          ],
        },
      ],
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/server/engine',
              from: './src',
              except: ['./server/engine'],
              message:
                'The Kongsi Engine is pure: it cannot import from outside src/server/engine (R4).',
            },
          ],
        },
      ],
    },
  },
  {
    // R1: route handlers read the session from the request.
    files: ['src/app/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/headers',
              message: 'Route handlers read the session from the request (R1).',
            },
          ],
        },
      ],
    },
  },
]);
