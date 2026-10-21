import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
// One shared instance: ESLint startup is slow (20-60 s), so the config loads once.
const eslint = new ESLint({ cwd: root });

describe('lint rules', { timeout: 120_000 }, () => {
  it('stops engine files importing anything outside the engine', async () => {
    const [r] = await eslint.lintText(
      "import { x } from '@/server/platform/db';\nexport const y = x;\n",
      { filePath: 'src/server/engine/probe.ts' },
    );
    expect(r!.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });
  it('lets engine files import each other', async () => {
    const [r] = await eslint.lintText("import { a } from './money';\nexport const b = a;\n", {
      filePath: 'src/server/engine/probe.ts',
    });
    expect(r!.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });
  it('stops server code reading the system time', async () => {
    const [r] = await eslint.lintText('export const t = Date.now();\n', {
      filePath: 'src/server/modules/probe.ts',
    });
    expect(r!.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax');
  });
  it('lets the clock adapter read the system time', async () => {
    const [r] = await eslint.lintText('export const t = Date.now();\n', {
      filePath: 'src/server/adapters/clock.ts',
    });
    expect(r!.messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toEqual([]);
  });
  it('stops route handlers importing next/headers', async () => {
    const [r] = await eslint.lintText(
      "import { cookies } from 'next/headers';\nexport const c = cookies;\n",
      { filePath: 'src/app/api/probe/route.ts' },
    );
    expect(r!.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });
  it('rejects Server Actions', async () => {
    const [r] = await eslint.lintText("'use server';\nexport async function a() {}\n", {
      filePath: 'src/app/probe.ts',
    });
    expect(r!.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax');
  });
  it('stops engine files importing a relative path that leaves the engine', async () => {
    const [r] = await eslint.lintText(
      "import { createPrismaClient } from '../platform/db';\nexport const y = createPrismaClient;\n",
      { filePath: 'src/server/engine/probe.ts' },
    );
    expect(r!.messages.map((m) => m.ruleId)).toContain('import/no-restricted-paths');
  });
  it('stops engine files using dynamic import()', async () => {
    const [r] = await eslint.lintText("export const y = await import('../platform/db');\n", {
      filePath: 'src/server/engine/probe.ts',
    });
    expect(r!.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax');
  });
  it('keeps the time and Server Action bans on engine files', async () => {
    const [r] = await eslint.lintText(
      "'use server';\nexport const t = Date.now();\nexport const u = new Date();\n",
      { filePath: 'src/server/engine/probe.ts' },
    );
    expect(r!.messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(3);
  });
  it('lets engine files import each other without any engine rule firing', async () => {
    const [r] = await eslint.lintText("import { a } from './money';\nexport const b = a;\n", {
      filePath: 'src/server/engine/probe.ts',
    });
    expect(r!.messages.filter((m) => m.ruleId?.startsWith('import/no-restricted'))).toEqual([]);
    expect(r!.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });
  it('stops pages reading the system time', async () => {
    const [r] = await eslint.lintText('export const t = new Date();\n', {
      filePath: 'src/app/probe/page.tsx',
    });
    expect(r!.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax');
  });
  it('stops bare Date() calls', async () => {
    const [r] = await eslint.lintText('export const t = Date();\n', {
      filePath: 'src/lib/probe.ts',
    });
    expect(r!.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax');
  });
  it('still rejects Server Actions in src/app alongside the time rule', async () => {
    const [r] = await eslint.lintText("'use server';\nexport const t = new Date(0);\n", {
      filePath: 'src/app/probe/page.tsx',
    });
    expect(r!.messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(1);
    const [s] = await eslint.lintText("'use server';\nexport const t = new Date();\n", {
      filePath: 'src/app/probe/page.tsx',
    });
    expect(s!.messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(2);
  });
  it('stops server code importing next/headers except session-page', async () => {
    const code = "import { cookies } from 'next/headers';\nexport const c = cookies;\n";
    const [bad] = await eslint.lintText(code, { filePath: 'src/server/modules/probe.ts' });
    expect(bad!.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
    const [ok] = await eslint.lintText(code, { filePath: 'src/server/platform/session-page.ts' });
    expect(ok!.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });
  it('stops engine files importing next/headers', async () => {
    const [r] = await eslint.lintText(
      "import { cookies } from 'next/headers';\nexport const c = cookies;\n",
      { filePath: 'src/server/engine/probe.ts' },
    );
    expect(r!.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });
});
