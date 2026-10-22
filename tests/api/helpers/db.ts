import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  name: string;
  adminUrl: string;
  appUrl: string;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const base = inject('pgAdminBase');
  const credentials = inject('pgAppCredentials');
  const name = `t_${randomBytes(4).toString('hex')}`;

  const admin = new Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  try {
    // Clones run concurrently. CREATE DATABASE ... TEMPLATE only fails when a session is connected
    // *to* the template (global setup closes those and nothing reconnects); concurrent clones take
    // a shared lock on it. Serialising them made every test file queue behind every other file's
    // clones (~1 s each on Windows), which pushed two-clone tests past their timeout.
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE bk_template`);
  } finally {
    await admin.end();
  }

  const host = new URL(base).host;
  return {
    name,
    adminUrl: `${base}/${name}`,
    appUrl: `postgresql://${credentials}@${host}/${name}`,
    async drop() {
      const client = new Client({ connectionString: `${base}/postgres` });
      await client.connect();
      try {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await client.end();
      }
    },
  };
}
