import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  projectRefFromUrl,
  runAdvisorCheck,
  runSecurityChecks,
} from '../../scripts/lib/security-checks';
import { getServerEnv, serverEnvKeys } from '../../src/server/platform/env';
import { checkRemoteOnly, describeTarget } from '../../scripts/lib/prod-env';
import { createTestDatabase } from './helpers/db';

async function withDb(fn: (db: { adminUrl: string; appUrl: string }) => Promise<void>) {
  const db = await createTestDatabase();
  try {
    await fn(db);
  } finally {
    await db.drop();
  }
}

async function adminExec(url: string, sql: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

describe('runSecurityChecks', () => {
  it('passes every security check on a migrated database', async () => {
    await withDb(async (db) => {
      const r = await runSecurityChecks(db.adminUrl, db.appUrl);
      expect(r.checks.filter((c) => !c.passed)).toEqual([]);
      expect(r.checks.find((c) => c.id === 'app_role')).toMatchObject({ passed: true });
      expect(r.checks.find((c) => c.id === 'app_role')?.warning).toBeFalsy();
    });
  });

  it('warns when the app connects as postgres (fallback mode)', async () => {
    await withDb(async (db) => {
      const r = await runSecurityChecks(db.adminUrl, db.adminUrl);
      const check = r.checks.find((c) => c.id === 'app_role');
      expect(check).toMatchObject({ passed: true, warning: true });
      expect(check?.detail).toMatch(/fallback/i);
    });
  });

  it('fails when a table loses row-level security', async () => {
    await withDb(async (db) => {
      await adminExec(db.adminUrl, 'alter table "demo_settings" disable row level security');
      const r = await runSecurityChecks(db.adminUrl, db.appUrl);
      const check = r.checks.find((c) => c.id === 'rls_enabled');
      expect(check?.passed).toBe(false);
      expect(check?.detail).toContain('demo_settings');
    });
  });

  it('fails when anon can read a table', async () => {
    await withDb(async (db) => {
      await adminExec(db.adminUrl, 'grant select on "demo_settings" to anon');
      const r = await runSecurityChecks(db.adminUrl, db.appUrl);
      expect(r.checks.find((c) => c.id === 'no_anon_access')?.passed).toBe(false);
    });
  });

  it('fails when a missing trigger or a TRUNCATE right appears', async () => {
    await withDb(async (db) => {
      await adminExec(db.adminUrl, 'drop trigger ledger_postings_append_only on "ledger_postings"');
      await adminExec(db.adminUrl, 'grant truncate on "demo_settings" to bk_app');
      const r = await runSecurityChecks(db.adminUrl, db.appUrl);
      expect(r.checks.find((c) => c.id === 'append_only_triggers')?.passed).toBe(false);
      expect(r.checks.find((c) => c.id === 'no_truncate')?.passed).toBe(false);
    });
  });

  it('fails demo_settings_locked when bk_app gets its demo_settings rights back', async () => {
    for (const grant of [
      'grant delete on "demo_settings" to bk_app',
      'grant update ("demo_mode") on "demo_settings" to bk_app',
    ]) {
      await withDb(async (db) => {
        const before = await runSecurityChecks(db.adminUrl, db.appUrl);
        expect(before.checks.find((c) => c.id === 'demo_settings_locked')?.passed).toBe(true);
        await adminExec(db.adminUrl, grant);
        const r = await runSecurityChecks(db.adminUrl, db.appUrl);
        expect(r.checks.find((c) => c.id === 'demo_settings_locked')?.passed).toBe(false);
      });
    }
  });

  it('fails, without leaking the URL, when the app cannot connect', async () => {
    await withDb(async (db) => {
      const bad = db.appUrl.replace(/:\/\/[^@]*@/, '://bk_app:wrong-pass-123@');
      const r = await runSecurityChecks(db.adminUrl, bad);
      const check = r.checks.find((c) => c.id === 'app_role');
      expect(check?.passed).toBe(false);
      expect(check?.detail).not.toContain('wrong-pass-123');
    });
  });
});

describe('runAdvisorCheck (no network)', () => {
  const respond = (status: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('sends the token as a Bearer header to the project advisor endpoint', async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const f = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: new Headers(init?.headers).get('authorization') };
      return new Response(JSON.stringify({ lints: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await runAdvisorCheck('abcref', 'tok', f);
    expect(seen).toEqual({
      url: 'https://api.supabase.com/v1/projects/abcref/advisors/security',
      auth: 'Bearer tok',
    });
    expect(r).toMatchObject({ id: 'supabase_advisor', passed: true });
    expect(r.warning).toBeFalsy();
  });

  it('fails on ERROR lints, warns on WARN and unknown levels', async () => {
    const lint = (level: string) => ({ lints: [{ name: 'x', title: 'T', level }] });
    expect((await runAdvisorCheck('r', 't', respond(200, lint('ERROR')))).passed).toBe(false);
    expect(await runAdvisorCheck('r', 't', respond(200, lint('WARN')))).toMatchObject({
      passed: true,
      warning: true,
    });
    expect(await runAdvisorCheck('r', 't', respond(200, lint('SURPRISE')))).toMatchObject({
      passed: true,
      warning: true,
    });
    expect((await runAdvisorCheck('r', 't', respond(200, lint('INFO')))).warning).toBeFalsy();
  });

  it.each([401, 403, 404, 429])('treats HTTP %i as advisor unavailable (warning)', async (s) => {
    expect(await runAdvisorCheck('r', 't', respond(s))).toMatchObject({
      passed: true,
      warning: true,
    });
  });

  it('treats a network error as advisor unavailable (warning)', async () => {
    const f = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await runAdvisorCheck('r', 't', f)).toMatchObject({ passed: true, warning: true });
  });

  it('reads the project ref from the Supabase URL', () => {
    expect(projectRefFromUrl('https://abcdef.supabase.co')).toBe('abcdef');
    expect(projectRefFromUrl('http://localhost:54321')).toBeNull();
  });
});

describe('deployment configuration', () => {
  it('lists every environment variable the server reads in .env.example', () => {
    const names = readFileSync('.env.example', 'utf8')
      .split('\n')
      .map((l) => l.split('=')[0]);
    for (const k of serverEnvKeys()) expect(names).toContain(k);
    expect(serverEnvKeys()).toContain('LOCAL_STORAGE_DIR');
  });

  it('schedules the job runner daily at 06:00 Malaysia time in Singapore', () => {
    const v = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(v.crons).toEqual([{ path: '/api/jobs/run', schedule: '0 22 * * *' }]);
    expect(v.regions).toEqual(['sin1']);
    expect(v.git.deploymentEnabled).toEqual({ main: true, '**': false });
  });
});

describe('Vercel start-up environment', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    SESSION_SECRET: 'a'.repeat(32),
    CRON_SECRET: 'b'.repeat(16),
    GEMINI_API_KEY: 'g',
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 's',
  };
  const good = { ...base, AI_ADAPTER: 'gemini', STORAGE_ADAPTER: 'supabase' };

  it('accepts a complete Vercel environment', () => {
    expect(getServerEnv({ ...good, VERCEL: '1' }).AI_ADAPTER).toBe('gemini');
  });

  it.each(['AI_ADAPTER', 'STORAGE_ADAPTER'])('names %s when it is missing on Vercel', (name) => {
    const source: Record<string, string> = { ...good, VERCEL: '1' };
    delete source[name];
    expect(() => getServerEnv(source)).toThrow(`${name} (required on Vercel`);
  });

  it('rejects fake AI and local storage on Vercel, without echoing values', () => {
    const source = { ...base, VERCEL: '1', AI_ADAPTER: 'fake', STORAGE_ADAPTER: 'local' };
    expect(() => getServerEnv(source)).toThrow(/AI_ADAPTER \(must be gemini on Vercel\)/);
    expect(() => getServerEnv(source)).toThrow(/STORAGE_ADAPTER \(must be supabase on Vercel\)/);
    expect(() => getServerEnv(source)).not.toThrow(/postgresql/);
  });

  it('keeps the defaults off Vercel', () => {
    expect(getServerEnv(base).AI_ADAPTER).toBe('fake');
  });
});

describe('prod script guards', () => {
  /** Built at run time so no password-bearing URL appears in the source. */
  const dbUrl = (host: string) => {
    const u = new URL(`postgresql://${host}/postgres`);
    u.username = 'postgres.ref';
    u.password = 'zz-not-a-real-pw';
    return u.toString();
  };

  it('refuses loopback database URLs and accepts remote ones', () => {
    for (const u of [
      'postgresql://postgres:postgres@localhost:54329/belikongsi',
      dbUrl('127.0.0.1:5432'),
      dbUrl('[::1]:5432'),
    ]) {
      expect(checkRemoteOnly(u, 'MIGRATION_DATABASE_URL')).toMatch(/MIGRATION_DATABASE_URL/);
    }
    expect(checkRemoteOnly('not a url', 'V')).toMatch(/not a valid URL/);
    expect(checkRemoteOnly(dbUrl('aws-0.pooler.supabase.com:5432'), 'V')).toBeNull();
  });

  it('describes the target without the user or password', () => {
    const t = describeTarget(dbUrl('host.example.com:5432'));
    expect(t).toBe('host.example.com:5432/postgres');
  });

  it('does not read env files or fill in missing variables', () => {
    const code = readFileSync('scripts/lib/prod-env.ts', 'utf8');
    expect(code).not.toMatch(/loadEnvFile/);
  });
});
