import { Client, escapeLiteral } from 'pg';

/** Lets the bk_app role log in with the given password. Shared by db:setup-role and prod:setup-role. */
export async function setupAppRole(migrationUrl: string, password: string): Promise<void> {
  if (!password.trim()) throw new Error('BK_APP_DB_PASSWORD is not set or is blank.');
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await client.query(`ALTER ROLE bk_app WITH LOGIN PASSWORD ${escapeLiteral(password)}`);
  } finally {
    await client.end();
  }
}
