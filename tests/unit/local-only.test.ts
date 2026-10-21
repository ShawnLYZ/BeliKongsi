import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLocalOnly } from '../../scripts/lib/local-only';

const root = resolve(import.meta.dirname, '../..');

describe('checkLocalOnly', () => {
  it.each([
    'postgresql://postgres:postgres@localhost:54329/belikongsi',
    'postgresql://postgres:postgres@127.0.0.1:54330/x',
    'postgresql://postgres:postgres@[::1]:54331/x',
  ])('accepts %s', (url) => {
    expect(checkLocalOnly(url)).toBeNull();
  });

  it.each([
    'postgresql://postgres:<password>@db.example.com:5432/postgres',
    'postgresql://postgres:<password>@db.example.com:54329/postgres',
    'postgresql://postgres:<password>@localhost:5432/postgres',
    'postgresql://postgres:<password>@localhost/postgres',
    'postgresql://postgres:<password>@localhost.evil.com:54329/postgres',
    'not a url',
    '',
  ])('refuses %s without echoing it', (url) => {
    const message = checkLocalOnly(url);
    expect(message).toContain('MIGRATION_DATABASE_URL');
    expect(message).not.toContain('<password>');
    expect(message).not.toContain('example.com');
  });

  it('refuses when unset', () => {
    expect(checkLocalOnly(undefined)).toContain('not set');
  });

  it('the CLI exits non-zero for a remote host and prints no value', () => {
    const res = spawnSync(
      process.execPath,
      [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'scripts/assert-local-db.ts')],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: 'postgresql://postgres:<password>@db.example.com:5432/postgres',
        },
      },
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('MIGRATION_DATABASE_URL');
    expect(res.stderr).not.toContain('example.com');
  });
});
