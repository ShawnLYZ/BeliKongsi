import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { serverEnvKeys } from '../src/server/platform/env';
import { scanChunk, type BundleFinding } from './lib/bundle-scan';

const ROOT = '.next/static';

function listChunks(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listChunks(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

function main(): number {
  let chunks: string[];
  try {
    chunks = listChunks(ROOT);
  } catch {
    console.error(`check-client-bundle: ${ROOT} not found; run pnpm build first.`);
    return 2;
  }
  if (chunks.length === 0) {
    console.error('check-client-bundle: no client chunks found.');
    return 2;
  }
  const keys = serverEnvKeys();
  const findings: BundleFinding[] = chunks.flatMap((c) =>
    scanChunk(c, readFileSync(c, 'utf8'), keys),
  );
  for (const f of findings) console.log(`${f.path} ${f.kind} ${f.detail}`); // never print content
  if (findings.length > 0) {
    console.error(`check-client-bundle: ${findings.length} finding(s) in client chunks.`);
    return 1;
  }
  console.log(`check-client-bundle: ${chunks.length} client chunks clean.`);
  return 0;
}

process.exitCode = main();
