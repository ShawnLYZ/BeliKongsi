/**
 * Pre-demo checklist: dependency audit, AI accuracy, end-to-end test against a deployment,
 * then the manual checks that need a person.
 *
 *   pnpm predemo --skip-ai                       audit only
 *   pnpm predemo --url https://<app>.vercel.app  audit, AI accuracy, e2e against the URL
 */
import { spawn } from 'node:child_process';

interface Step {
  name: string;
  command: string;
  env?: Record<string, string>;
}

function parseArgs(argv: string[]): { skipAi: boolean; url: string | null } {
  let skipAi = false;
  let url: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--skip-ai') skipAi = true;
    else if (arg === '--url') url = argv[++i] ?? '';
    else if (arg.startsWith('--url=')) url = arg.slice('--url='.length);
    else throw new Error(`Unknown option: ${arg}. Use --skip-ai and/or --url <deployed-url>.`);
  }
  if (url !== null) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol');
    } catch {
      throw new Error(`--url must be a full http(s) address, got "${url}".`);
    }
  }
  return { skipAi, url };
}

/** Runs one command through the shell so `pnpm` resolves on Windows (pnpm.cmd) and elsewhere. */
function run(step: Step): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...step.env },
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const MANUAL_CHECKS = [
  'Press "Reset demo data" in the deployed app.',
  '"Verify log" shows ✅.',
  'The money overview shows ✅.',
];

async function main(): Promise<void> {
  const { skipAi, url } = parseArgs(process.argv.slice(2));

  const steps: Step[] = [{ name: 'Dependency audit', command: 'pnpm audit --prod' }];
  if (skipAi) console.log('Skipping the AI accuracy set (--skip-ai).');
  else steps.push({ name: 'AI accuracy set', command: 'pnpm ai:accuracy' });
  if (url)
    steps.push({
      name: `End-to-end test against ${url}`,
      command: 'pnpm e2e',
      env: { BASE_URL: url },
    });
  else console.log('Skipping the deployed end-to-end test (no --url given).');

  for (const [index, step] of steps.entries()) {
    console.log(`\n=== Step ${index + 1} of ${steps.length}: ${step.name} ===`);
    const code = await run(step);
    if (code !== 0) {
      console.error(`\nFAILED: ${step.name} (exit code ${code}). Stopping.`);
      process.exit(code);
    }
    console.log(`PASSED: ${step.name}`);
  }

  console.log('\nAutomated checks passed. Now check by hand, in the deployed app:');
  MANUAL_CHECKS.forEach((check, i) => console.log(`  ${i + 1}. ${check}`));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
