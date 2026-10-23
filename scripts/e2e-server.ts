/**
 * The server the end-to-end test runs against (playwright.config.ts starts it; `pnpm e2e:server`
 * runs it by hand): a throwaway embedded Postgres on port 54331 with a freshly migrated and seeded
 * database, then `next build` (skipped with SKIP_BUILD=1) and `next start -p 3100`, with the fake
 * AI adapter, local storage in .data/storage-e2e and demo mode on.
 *
 * Postgres is started with `pg_ctl start`, so it is not a descendant of this process: Playwright
 * stops the web server on Windows with `taskkill /T /F`, which would kill a child postmaster
 * mid-flight and can leave an orphaned backend holding the port (see scripts/lib/embedded-pg.ts).
 * A small watchdog, also outside this process tree, stops Postgres cleanly once this process is
 * gone, however it ended. Ctrl+C and SIGTERM stop `next start` and Postgres directly.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { createUtf8DatabaseSql, isPortListening } from './lib/embedded-pg';

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..');
const PG_DIR = join(ROOT, '.data', 'pg-e2e');
const PG_LOG = join(ROOT, '.data', 'pg-e2e.log');
const PG_PORT = 54331;
const PG_ADMIN_PASSWORD = 'postgres';
const DB_NAME = 'belikongsi_e2e';
const APP_PORT = 3100;
const STORAGE_DIR = '.data/storage-e2e';

/** Fixed values for a throwaway local server; they guard nothing outside this machine. */
const LOCAL_ONLY = 'e2e-local-only-value';

// The admin password is PG_ADMIN_PASSWORD ('postgres'), written out so the secret scan can read it.
const adminUrl = (db: string) => `postgresql://postgres:postgres@localhost:${PG_PORT}/${db}`;

const E2E_ENV: Record<string, string> = {
  DATABASE_URL: `postgresql://bk_app:e2e@localhost:${PG_PORT}/${DB_NAME}`,
  MIGRATION_DATABASE_URL: adminUrl(DB_NAME),
  BK_APP_DB_PASSWORD: 'e2e',
  SESSION_SECRET: `${LOCAL_ONLY}-session-0123456789`,
  CRON_SECRET: `${LOCAL_ONLY}-cron`,
  AI_ADAPTER: 'fake',
  STORAGE_ADAPTER: 'local',
  LOCAL_STORAGE_DIR: STORAGE_DIR,
  DEMO_MODE: 'true',
};

const childEnv = { ...process.env, ...E2E_ENV };
const bin = (path: string) => join(ROOT, 'node_modules', ...path.split('/'));
const log = (message: string) => console.log(`[e2e-server] ${message}`);

/** pg_ctl from the embedded-postgres binaries package for this platform. */
async function pgCtlPath(): Promise<string> {
  const os = platform() === 'win32' ? 'windows' : platform();
  const require = createRequire(fileURLToPath(import.meta.resolve('embedded-postgres')));
  const entry = require.resolve(`@embedded-postgres/${os}-${arch()}`);
  const binaries = (await import(pathToFileURL(entry).href)) as { pg_ctl: string };
  return binaries.pg_ctl;
}

async function isClusterRunning(pgCtl: string): Promise<boolean> {
  try {
    await execFileAsync(pgCtl, ['status', '-D', PG_DIR], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Starts Postgres from PG_DIR (initialising it first if needed); returns the postmaster's pid. */
async function startPostgres(pgCtl: string): Promise<string> {
  if (!existsSync(join(PG_DIR, 'PG_VERSION'))) {
    log(`initialising ${PG_DIR}`);
    await new EmbeddedPostgres({
      databaseDir: PG_DIR,
      port: PG_PORT,
      user: 'postgres',
      password: PG_ADMIN_PASSWORD,
      persistent: true,
      authMethod: 'scram-sha-256',
      initdbFlags: ['--encoding=UTF8'],
      onLog: () => {},
      onError: (m) => console.error(String(m)),
    }).initialise();
  }

  // Left running by an earlier run whose watchdog has not stopped it yet (back-to-back runs). The
  // database is recreated anyway, so stop it and start afresh: the earlier watchdog only stops
  // the postmaster it was watching.
  if (await isClusterRunning(pgCtl)) {
    log('stopping the Postgres left running by an earlier run');
    await stopPostgres(pgCtl);
  }
  if (await isPortListening(PG_PORT)) {
    throw new Error(
      `Port ${PG_PORT} is already in use by something other than ${PG_DIR}; stop it and try again.`,
    );
  }
  // A crash leaves postmaster.pid behind; nothing is listening, so it is stale.
  rmSync(join(PG_DIR, 'postmaster.pid'), { force: true });

  log(`starting Postgres on port ${PG_PORT}`);
  // stdio 'ignore': the postmaster must not inherit pipes from here, or this wait (and later
  // Playwright's) would last as long as Postgres does.
  const code = await new Promise<number | null>((done, fail) => {
    const pgCtlStart = spawn(
      pgCtl,
      ['start', '-D', PG_DIR, '-o', `-p ${PG_PORT}`, '-l', PG_LOG, '-w', '-t', '60'],
      { stdio: 'ignore', windowsHide: true },
    );
    pgCtlStart.once('error', fail);
    pgCtlStart.once('exit', done);
  });
  if (code !== 0) throw new Error(`Postgres did not start (exit code ${code}); see ${PG_LOG}.`);
  return postmasterPid();
}

/** The running postmaster's process id: the first line of postmaster.pid. */
function postmasterPid(): string {
  return readFileSync(join(PG_DIR, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0]!.trim();
}

async function stopPostgres(pgCtl: string): Promise<void> {
  if (!existsSync(join(PG_DIR, 'postmaster.pid'))) return;
  await execFileAsync(pgCtl, ['stop', '-D', PG_DIR, '-m', 'fast', '-w', '-t', '60'], {
    windowsHide: true,
  }).catch(() => {
    // Already stopped, or the watchdog got there first.
  });
}

/**
 * Starts a watchdog outside this process tree (a detached relay starts it and exits at once, so it
 * has no living parent here). It polls this process and, once this process is gone, stops
 * Postgres if the postmaster is still the one started here (a later run may have started its own).
 */
function startWatchdog(pgCtl: string, postmaster: string): void {
  const watchdog = String.raw`
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const { execFileSync } = require('node:child_process');
    const [parentPid, pgCtl, dir, postmaster] = process.argv.slice(1);
    const alive = () => { try { process.kill(Number(parentPid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    const running = () => { try { return readFileSync(join(dir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0].trim(); } catch { return null; } };
    const timer = setInterval(() => {
      if (alive()) return;
      clearInterval(timer);
      if (running() !== postmaster) return;
      try { execFileSync(pgCtl, ['stop', '-D', dir, '-m', 'fast', '-w', '-t', '60'], { stdio: 'ignore', windowsHide: true }); } catch {}
    }, 1000);`;
  const relay = `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', process.argv[1], ...process.argv.slice(2)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();`;
  const args = [watchdog, String(process.pid), pgCtl, PG_DIR, postmaster];
  spawn(process.execPath, ['-e', relay, ...args], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function recreateDatabase(): Promise<void> {
  const client = new Client({ connectionString: adminUrl('postgres') });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await client.query(createUtf8DatabaseSql(DB_NAME));
  } finally {
    await client.end();
  }
}

/** Child processes still running, stopped on shutdown. */
const children = new Set<ChildProcess>();

/** Starts a Node entry point with the e2e environment (no stdin: a pipe left open can stall it). */
function startNode(args: string[]): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

/** Runs a Node entry point to completion; rejects on a non-zero exit. */
function runNode(label: string, args: string[]): Promise<void> {
  log(label);
  return new Promise((done, fail) => {
    const child = startNode(args);
    child.once('error', fail);
    child.once('exit', (code, signal) =>
      code === 0 ? done() : fail(new Error(`${label} failed (${signal ?? `exit code ${code}`}).`)),
    );
  });
}

async function main(): Promise<void> {
  if (await isPortListening(APP_PORT)) {
    console.error(
      `[e2e-server] Port ${APP_PORT} is already in use by a server that does not pass the /api/health check (or reuse is off, as in CI). Stop it and try again.`,
    );
    process.exit(1);
  }

  const pgCtl = await pgCtlPath();

  let stopping = false;
  const shutdown = async (code: number) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill();
    await stopPostgres(pgCtl);
    process.exit(code);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => void shutdown(0));
  }

  try {
    startWatchdog(pgCtl, await startPostgres(pgCtl));
    await recreateDatabase();
    rmSync(join(ROOT, STORAGE_DIR), { recursive: true, force: true });
    mkdirSync(join(ROOT, STORAGE_DIR), { recursive: true });

    await runNode('applying migrations', [bin('prisma/build/index.js'), 'migrate', 'deploy']);
    await runNode('letting bk_app log in', [bin('tsx/dist/cli.mjs'), 'scripts/db-setup-role.ts']);
    await runNode('seeding the demo data', [bin('tsx/dist/cli.mjs'), 'prisma/seed/cli.ts']);
    if (process.env.SKIP_BUILD === '1') {
      log('SKIP_BUILD=1: using the existing .next build');
    } else {
      await runNode('building the app', [bin('next/dist/bin/next'), 'build']);
    }
  } catch (error) {
    console.error(`[e2e-server] ${error instanceof Error ? error.message : String(error)}`);
    await shutdown(1);
    return;
  }

  log(`starting the app on http://localhost:${APP_PORT}`);
  const server = startNode([bin('next/dist/bin/next'), 'start', '-p', String(APP_PORT)]);
  server.once('exit', (code) => {
    if (stopping) return;
    console.error(`[e2e-server] next start exited (code ${code}).`);
    void shutdown(1);
  });
}

main().catch((error: unknown) => {
  console.error(`[e2e-server] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
