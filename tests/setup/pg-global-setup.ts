import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { createUtf8DatabaseSql, startCluster, type Cluster } from '../../scripts/lib/embedded-pg';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminBase: string;
    pgAppCredentials: string;
  }
}

const PORT = 54330;
const ADMIN_PASSWORD = 'postgres';
const APP_CREDENTIALS = 'bk_app:bk_app_test';
const root = resolve(import.meta.dirname, '../..');

// embedded-postgres registers an async-exit-hook that calls process.exit(0) on 'beforeExit',
// which would overwrite the exit code vitest sets for failing tests. Remember it and restore it.
let savedExitCode: typeof process.exitCode;
process.prependListener('beforeExit', () => {
  savedExitCode = process.exitCode;
});
process.on('exit', () => {
  if (savedExitCode) process.exitCode = savedExitCode;
});

function listMigrationFiles(): string[] {
  return globSync('prisma/migrations/**/*', { cwd: root })
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => /\.(sql|toml)$/.test(f))
    .sort();
}

/** SHA-256 over every migration file (path and content), so any change rebuilds the template. */
function hashMigrations(files: string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(resolve(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureTemplate(adminUrl: (db?: string) => string): Promise<void> {
  const files = listMigrationFiles();
  const hash = hashMigrations(files);
  const current = await withClient(adminUrl('postgres'), async (c) => {
    const r = await c.query<{ comment: string | null; encoding: string }>(
      `select shobj_description(oid, 'pg_database') as comment, pg_encoding_to_char(encoding) as encoding from pg_database where datname = 'bk_template'`,
    );
    const row = r.rows[0];
    if (!row) return null;
    // A template built in another encoding (older Windows clusters) is rebuilt as UTF-8.
    return row.encoding === 'UTF8' ? (row.comment ?? '') : null;
  });

  if (current !== hash) {
    await withClient(adminUrl('postgres'), async (c) => {
      await c.query('DROP DATABASE IF EXISTS bk_template WITH (FORCE)');
      await c.query(createUtf8DatabaseSql('bk_template'));
    });
    // Before the baseline migration exists there is nothing to deploy.
    if (files.length > 0) {
      const run = promisify(execFile);
      await run(
        process.execPath,
        [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
        { cwd: root, env: { ...process.env, MIGRATION_DATABASE_URL: adminUrl('bk_template') } },
      );
    }
    await withClient(adminUrl('bk_template'), async (c) => {
      await c.query(`COMMENT ON DATABASE bk_template IS '${hash}'`);
    });
    console.info('[pg-global-setup] rebuilt bk_template');
  } else {
    console.info('[pg-global-setup] reusing bk_template');
  }

  const [user, password] = APP_CREDENTIALS.split(':');
  await withClient(adminUrl('postgres'), async (c) => {
    // Roles are cluster-wide. Migrations create it once they exist; this covers the gap before.
    const found = await c.query('select 1 from pg_roles where rolname = $1', [user]);
    if (found.rowCount === 0) await c.query(`CREATE ROLE ${user} NOLOGIN`);
    await c.query(`ALTER ROLE ${user} WITH LOGIN PASSWORD '${password}'`);
    // A template cannot be cloned while anyone is connected to it.
    await c.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = 'bk_template' and pid <> pg_backend_pid()`,
    );
  });
}

/** Drops per-test databases (t_*) left behind by a crashed run. */
async function dropLeftoverTestDatabases(adminUrl: (db?: string) => string): Promise<void> {
  await withClient(adminUrl('postgres'), async (c) => {
    const r = await c.query<{ datname: string }>(
      `select datname from pg_database where datname like 't\_%' and not datistemplate`,
    );
    for (const { datname } of r.rows) {
      await c.query(`DROP DATABASE IF EXISTS "${datname.replace(/"/g, '""')}" WITH (FORCE)`);
    }
  });
}

/**
 * Projects sharing this setup (`api`, `api-serial`) share one cluster; the last teardown stops it.
 * Vitest loads the file once per project, so the shared state lives on `globalThis`.
 */
interface SharedSetup {
  users: number;
  starting?: Promise<void>;
  cluster?: Cluster;
}
const shared = ((globalThis as { __bkPgSetup?: SharedSetup }).__bkPgSetup ??= { users: 0 });

async function startOnce(): Promise<void> {
  const cluster = await startCluster({
    dir: resolve(root, '.data/pg-test'),
    port: PORT,
    password: ADMIN_PASSWORD,
  });
  shared.cluster = cluster;
  try {
    await dropLeftoverTestDatabases(cluster.adminUrl);
    await ensureTemplate(cluster.adminUrl);
  } catch (error) {
    await cluster.stop();
    shared.cluster = undefined;
    throw error;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  shared.users += 1;
  shared.starting ??= startOnce();
  try {
    await shared.starting;
  } catch (error) {
    shared.users -= 1;
    shared.starting = undefined;
    throw error;
  }
  const base = new URL(`postgresql://localhost:${PORT}`);
  base.username = 'postgres';
  base.password = ADMIN_PASSWORD;
  project.provide('pgAdminBase', base.toString().replace(/\/$/, ''));
  project.provide('pgAppCredentials', APP_CREDENTIALS);

  return async () => {
    shared.users -= 1;
    if (shared.users > 0) return;
    shared.starting = undefined;
    await shared.cluster?.stop();
    shared.cluster = undefined;
  };
}
