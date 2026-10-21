import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  name: string;
  adminUrl: string;
  appUrl: string;
  drop(): Promise<void>;
}

const CLONE_LOCK = 424242;

export async function createTestDatabase(): Promise<TestDatabase> {
  const base = inject('pgAdminBase');
  const credentials = inject('pgAppCredentials');
  const name = `t_${randomBytes(4).toString('hex')}`;

  const admin = new Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  try {
    // CREATE DATABASE ... TEMPLATE needs exclusive use of the template, so clones queue up.
    await admin.query('select pg_advisory_lock($1)', [CLONE_LOCK]);
    try {
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE bk_template`);
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [CLONE_LOCK]);
    }
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
