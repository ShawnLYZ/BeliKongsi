import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

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

export async function startCluster(opts: ClusterOptions): Promise<Cluster> {
  const { dir, port, password, log } = opts;
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: 'postgres',
    password,
    persistent: true,
    authMethod: 'scram-sha-256',
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

  await pg.start();

  return {
    stop: () => pg.stop(),
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

export async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const found = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (found.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}
