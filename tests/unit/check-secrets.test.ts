import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isForbiddenPath, scanText } from '../../scripts/lib/secret-patterns';

const root = resolve(import.meta.dirname, '../..');
const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs');
const script = resolve(root, 'scripts/check-secrets.ts');

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
}

function makeRepo(): { dir: string; git: (...args: string[]) => ReturnType<typeof spawnSync> } {
  const dir = mkdtempSync(join(tmpdir(), 'bk-secrets-'));
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  return { dir, git };
}

function runCli(dir: string, mode: string) {
  return spawnSync(process.execPath, [tsx, script, mode], {
    cwd: dir,
    encoding: 'utf8',
    env: cleanEnv(),
  });
}

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
    expect(isForbiddenPath('api_key_configuration.MD')).toBe(true);
  });
  it('blocks a force-added key file in a real git repository', () => {
    const { dir, git } = makeRepo();
    try {
      writeFileSync(join(dir, 'API_Key_Configuration.md'), 'nothing secret here\n');
      expect(git('add', '-f', 'API_Key_Configuration.md').status).toBe(0);
      const res = runCli(dir, '--staged');
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('API_Key_Configuration.md');
      expect(res.stdout).toContain('forbidden-file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
  it('fails closed when a tracked file cannot be read', () => {
    const { dir, git } = makeRepo();
    try {
      writeFileSync(join(dir, 'a.txt'), 'hello\n');
      git('add', 'a.txt');
      // A directory where a tracked file was: listed by ls-files, unreadable (EISDIR).
      rmSync(join(dir, 'a.txt'));
      mkdirSync(join(dir, 'a.txt'));
      const res = runCli(dir, '--all');
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('a.txt: unreadable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
  it('skips binary files without crashing', () => {
    expect(scanText('a.png', '\u0000\u0001PNG')).toEqual([]);
  });
});

describe('generic and Supabase secrets', () => {
  const rand = (n: number) => 'x7Q'.repeat(Math.ceil(n / 3)).slice(0, n);
  const kinds = (text: string, path = 'config.env') => scanText(path, text).map((f) => f.kind);

  it('flags a real-looking value assigned to a secret-named variable', () => {
    expect(kinds(`SESSION_SECRET=${rand(32)}\n`)).toEqual(['generic-secret']);
    expect(kinds(`export API_TOKEN="${rand(24)}"\n`)).toEqual(['generic-secret']);
    expect(kinds(`  db_PASSWORD: ${rand(12)}`.replace('db_', 'DB_'))).toEqual(['generic-secret']);
    expect(kinds(`SERVICE_ROLE_KEY=${rand(30)}\n`)).toEqual(['generic-secret']);
  });
  it('lets placeholders, empty values, references and local-only values through', () => {
    expect(kinds('SESSION_SECRET=<generate-me>\n')).toEqual([]);
    expect(kinds('CRON_SECRET=\n')).toEqual([]);
    expect(kinds('CRON_SECRET=${CRON_SECRET}\n')).toEqual([]);
    expect(kinds('const SESSION_SECRET = process.env.X;\n')).toEqual([]);
    expect(kinds('BK_APP_DB_PASSWORD=bk_app_dev\n')).toEqual([]);
    expect(kinds('POSTGRES_PASSWORD=postgres\n')).toEqual([]);
    expect(kinds('PGPASSWORD="e2e"\n')).toEqual([]);
    expect(kinds('SESSION_SECRET: z.string().min(32),\n')).toEqual([]);
  });
  it('does not flag test fixtures', () => {
    expect(kinds(`SESSION_SECRET: '${rand(32)}',\n`, 'tests/unit/a.test.ts')).toEqual([]);
  });
  it('flags a Supabase secret key built at runtime', () => {
    const key = ['sb', 'secret', rand(30)].join('_');
    expect(kinds(`url = ${key}\n`)).toEqual(['supabase-secret']);
  });
});
