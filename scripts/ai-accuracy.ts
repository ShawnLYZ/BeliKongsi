import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { createGeminiOrderReader } from '../src/server/adapters/ai/gemini';
import { redactPersonalData } from '../src/server/adapters/ai/redact';
import type { CatalogueEntry, ReadResult } from '../src/server/adapters/ai/types';
import { PRODUCTS } from '../prisma/seed/catalogue';
import { seedId } from '../prisma/seed/ids';
import { scoreOrder, type AccuracyFixture, type OrderScore } from './lib/ai-accuracy-scoring';

// Load env files like the image script (no override). The key is read from process.env and never printed.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // The file is optional.
  }
}

const FIXTURE_DIR = join('tests', 'fixtures', 'ai-accuracy');
const DOC = join('docs', 'ai-accuracy.md');
const PASS_MARK = 18;
const GAP_MS = 1000;

const catalogue: CatalogueEntry[] = PRODUCTS.map((p) => ({
  id: seedId('product', p.key),
  name: p.name,
  packDescription: p.packDescription,
  unitName: p.unitName,
  aliases: p.aliases,
  packConversions: p.packConversions,
}));
const keyById = new Map<string, string>(PRODUCTS.map((p) => [seedId('product', p.key), p.key]));

function describeResult(r: ReadResult): string {
  return r.lines
    .map((l) => {
      const who = l.productId ? (keyById.get(l.productId) ?? 'INVENTED') : 'null';
      return `${who} x${l.quantity ?? '?'}`;
    })
    .join('; ');
}

/** The adapter hides the API status, so a probe tells "model unavailable" from other failures. */
async function probeStatus(apiKey: string, model: string): Promise<string> {
  try {
    await new GoogleGenAI({ apiKey }).models.generateContent({ model, contents: 'ping' });
    return 'probe succeeded';
  } catch (e) {
    const status = (e as { status?: unknown }).status;
    return `HTTP status ${typeof status === 'number' ? status : 'unknown'}`;
  }
}

function modelArg(): string {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--model');
  const model = at === -1 ? undefined : argv[at + 1];
  if (!model) throw new Error('Usage: pnpm ai:accuracy -- --model <name>');
  return model;
}

/** Replaces this model's section of the doc (or appends it), leaving the hand-written text alone. */
async function writeSection(model: string, section: string): Promise<void> {
  const start = `<!-- run:${model} -->`;
  const end = `<!-- /run:${model} -->`;
  const block = `${start}\n${section}\n${end}`;
  let doc: string;
  try {
    doc = await readFile(DOC, 'utf8');
  } catch {
    doc = '# AI accuracy\n';
  }
  const a = doc.indexOf(start);
  const b = doc.indexOf(end);
  doc =
    a !== -1 && b !== -1
      ? doc.slice(0, a) + block + doc.slice(b + end.length)
      : `${doc.trimEnd()}\n\n${block}\n`;
  await writeFile(DOC, doc);
}

async function main(): Promise<void> {
  const model = modelArg();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || /^<.*>$/.test(apiKey)) throw new Error('GEMINI_API_KEY is not set in .env.local.');

  const files = (await readdir(FIXTURE_DIR)).filter((f) => f.endsWith('.json')).sort();
  const fixtures: AccuracyFixture[] = [];
  for (const f of files) {
    fixtures.push(JSON.parse(await readFile(join(FIXTURE_DIR, f), 'utf8')) as AccuracyFixture);
  }
  const reader = createGeminiOrderReader({ apiKey, model });

  const rows: { id: string; score: OrderScore | null; got: string; error?: string }[] = [];
  for (const [i, fx] of fixtures.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
    try {
      const result = await reader.readOrderText({
        text: redactPersonalData(fx.text).text,
        catalogue,
      });
      rows.push({
        id: fx.id,
        score: scoreOrder(fx, result, keyById),
        got: describeResult(result),
      });
    } catch (e) {
      rows.push({
        id: fx.id,
        score: null,
        got: '',
        error: e instanceof Error ? e.message : 'error',
      });
    }
    const r = rows.at(-1)!;
    console.log(`${r.id}  ${r.score ? (r.score.correct ? 'PASS' : 'FAIL') : 'ERROR'}`);
  }

  const correct = rows.filter((r) => r.score?.correct).length;
  const invented = rows.reduce((n, r) => n + (r.score?.invented.length ?? 0), 0);
  const errors = rows.filter((r) => !r.score).length;
  const unavailable = errors === rows.length ? await probeStatus(apiKey, model) : null;
  const qualifies = correct >= PASS_MARK && invented === 0;
  const myt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());

  const cell = (s: string) => s.replaceAll('|', '/') || '-';
  const lines = [
    `## Run: ${model}`,
    '',
    `Date: ${myt} MYT`,
    '',
    `Result: **${correct}/${fixtures.length} correct, ${invented} invented ids, ${errors} errors** - ${qualifies ? 'qualifies' : 'does not qualify'} (bar: at least ${PASS_MARK}/${fixtures.length} and 0 invented ids).`,
    ...(unavailable ? ['', `All calls failed (${unavailable}): model unavailable.`] : []),
    '',
    '| Order | Result | Problems | Model read |',
    '| ----- | ------ | -------- | ---------- |',
    ...rows.map((r) => {
      const res = r.score ? (r.score.correct ? 'pass' : 'FAIL') : 'error';
      const problems = r.score ? r.score.problems.join('; ') : (r.error ?? '');
      return `| ${r.id} | ${res} | ${cell(problems)} | ${cell(r.got)} |`;
    }),
  ];
  await writeSection(model, lines.join('\n'));
  console.log(
    `\n${model}: ${correct}/${fixtures.length} correct, ${invented} invented, ${errors} errors${unavailable ? ` (${unavailable})` : ''}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'accuracy run failed.');
  process.exit(1);
});
