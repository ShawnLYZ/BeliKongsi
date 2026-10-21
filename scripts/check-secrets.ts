import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isForbiddenPath, scanText, type Finding } from './lib/secret-patterns';

const MAX_BUFFER = 64 * 1024 * 1024;

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

function listPaths(mode: string): string[] {
  const out =
    mode === '--staged'
      ? git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])
      : git(['ls-files', '-z']);
  return out.split('\0').filter((p) => p.length > 0);
}

function readContent(mode: string, path: string): string {
  return mode === '--staged' ? git(['show', `:${path}`]) : readFileSync(path, 'utf8');
}

function main(): number {
  const mode = process.argv[2];
  if (mode !== '--staged' && mode !== '--all') {
    console.error('usage: check-secrets (--staged | --all)');
    return 2;
  }
  const findings: Finding[] = [];
  let unreadable = 0;
  for (const path of listPaths(mode)) {
    if (isForbiddenPath(path)) {
      findings.push({ path, line: 0, kind: 'forbidden-file' });
      continue;
    }
    let content: string;
    try {
      content = readContent(mode, path);
    } catch (error) {
      // Only a file deleted from the working tree (--all) may be skipped.
      if (mode === '--all' && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      console.error(`${path}: unreadable`); // never print content
      unreadable += 1;
      continue;
    }
    findings.push(...scanText(path, content));
  }
  for (const f of findings) console.log(`${f.path}:${f.line} ${f.kind}`);
  if (unreadable > 0) {
    console.error(`check-secrets: ${unreadable} file(s) could not be scanned; commit blocked.`);
    return 1;
  }
  if (findings.length > 0) {
    console.error(`check-secrets: ${findings.length} finding(s); commit blocked.`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
