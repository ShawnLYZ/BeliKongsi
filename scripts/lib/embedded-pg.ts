import { execFile, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

const execFileAsync = promisify(execFile);

export interface ClusterOptions {
  dir: string;
  port: number;
  password: string;
  log?: (m: string) => void;
}

export interface Cluster {
  stop(): Promise<void>;
  adminUrl(db?: string): string;
}

function probe(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** True when either loopback address (IPv4 or IPv6) accepts a connection on the port. */
export async function isPortListening(port: number): Promise<boolean> {
  const results = await Promise.all([probe(port, '127.0.0.1'), probe(port, '::1')]);
  return results.some(Boolean);
}

/**
 * Shuts the cluster down with `pg_ctl stop -m fast -w`, which returns only once the postmaster has
 * removed postmaster.pid — and it does that only after every child process has exited.
 *
 * embedded-postgres' own stop() is not safe on Windows: it runs `taskkill /f /t` and resolves when
 * the postmaster exits. taskkill kills the tree one process at a time, so under load the postmaster
 * can see a child (e.g. the checkpointer) die first, start crash recovery and spawn a new "startup"
 * child after taskkill took its snapshot. That child outlives the postmaster, keeps the inherited
 * listen socket open and blocks the port for the next start. A forced kill also leaves the data
 * directory unclean, so the next start has to run crash recovery.
 */
async function stopCluster(pg: EmbeddedPostgres, dir: string): Promise<void> {
  // embedded-postgres keeps the spawned postmaster in a private field; there is no public accessor.
  const holder = pg as unknown as { process?: ChildProcess };
  const child = holder.process;
  if (!child) return;
  const running = child.exitCode === null && child.signalCode === null;
  const exited = running
    ? new Promise<void>((resolve) => child.once('exit', () => resolve()))
    : Promise.resolve();
  const pgCtl = join(dirname(child.spawnfile), platform() === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');

  try {
    await execFileAsync(pgCtl, ['stop', '-D', dir, '-m', 'fast', '-w', '-t', '60']);
  } catch (error) {
    // The postmaster removes postmaster.pid last, after its children are gone. Without it the
    // cluster already shut down on its own (e.g. Ctrl+C reached it too), which is a clean stop.
    if (!existsSync(join(dir, 'postmaster.pid'))) {
      await exited;
      holder.process = undefined;
      return;
    }
    // Last resort: embedded-postgres' forced kill. Report the failure rather than hide it, since a
    // forced kill can leave children behind.
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([pg.stop(), exited]);
    }
    throw new Error(`pg_ctl stop failed for ${dir}: ${String(error)}`);
  }
  await exited;
  // Stops embedded-postgres' exit hook from trying to kill a process that is already gone.
  holder.process = undefined;
}

export async function startCluster(opts: ClusterOptions): Promise<Cluster> {
  const { dir, port, password, log } = opts;
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: 'postgres',
    password,
    persistent: true,
    authMethod: 'scram-sha-256',
    // On Windows initdb would pick the system code page (WIN1252), which cannot store Chinese text.
    initdbFlags: ['--encoding=UTF8'],
    onLog: (m) => log?.(String(m)),
    onError: (m) => log?.(String(m)),
  });

  if (!existsSync(join(dir, 'PG_VERSION'))) {
    await pg.initialise();
  }

  // A crash leaves postmaster.pid behind. Only remove it when nothing is listening;
  // if the port is in use, leave everything alone and let start() fail.
  const pidFile = join(dir, 'postmaster.pid');
  if (existsSync(pidFile)) {
    if (await isPortListening(port)) {
      throw new Error(
        `Port ${port} is already in use and ${pidFile} exists; another Postgres may be running from ${dir}.`,
      );
    }
    rmSync(pidFile, { force: true });
  }

  // Without a postmaster.pid, a listener on the port is still someone else's (often an orphaned
  // postgres child of a crashed run). embedded-postgres then rejects with `undefined`, which hides
  // the cause, so say it plainly before starting.
  if (await isPortListening(port)) {
    throw new Error(`Port ${port} is already in use; cannot start Postgres from ${dir}.`);
  }

  try {
    await pg.start();
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error(`Postgres failed to start on port ${port} (${dir}): ${String(err)}`);
  }

  return {
    stop: () => stopCluster(pg, dir),
    adminUrl: (db = 'postgres') => {
      const url = new URL('postgresql://localhost');
      url.username = 'postgres';
      url.password = password;
      url.port = String(port);
      url.pathname = `/${db}`;
      return url.toString();
    },
  };
}

/**
 * SQL that creates a UTF-8 database even in a cluster initialised with another encoding (a UTF-8
 * database in such a cluster must come from template0 with the C locale).
 */
export function createUtf8DatabaseSql(name: string): string {
  return `CREATE DATABASE "${name.replace(/"/g, '""')}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`;
}

export async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const found = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (found.rowCount === 0) {
      await client.query(createUtf8DatabaseSql(name));
    }
  } finally {
    await client.end();
  }
}
