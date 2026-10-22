import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  IMAGE_SEEDS,
  IMAGE_SUBJECTS,
  imageKeyFor,
  imagePrompt,
} from '../prisma/seed/image-subjects';
import { ALL_KEYS, ASSET_DIR, RAW_DIR, parseArgs, selectedKeys } from './lib/image-paths';

// Load env files like prisma.config.ts (no override). NVIDIA_API_KEY stays out of the server
// schema: this script reads it from process.env and never prints it.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // The file is optional.
  }
}

const ENDPOINT = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b';
const SIZE = 1024;
// The NVIDIA endpoint rejects steps > 4 (HTTP 422).
const DEFAULT_STEPS = 4;
const MAX_STEPS = 4;
const BASE_SEED = 7000;
const MAX_BYTES = 200 * 1024;
const OUT_SIZE = 512;

/** The response field names are undocumented, so accept the shapes sibling endpoints use. */
function extractBase64(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as Record<string, unknown>;
  const artifacts = r.artifacts;
  const first = Array.isArray(artifacts) ? (artifacts[0] as Record<string, unknown>) : undefined;
  const found = [first?.base64, r.image, r.b64_json].find(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return found ? found.replace(/^data:image\/\w+;base64,/, '') : null;
}

/** Truncates long strings so a response can be saved for discovery without the image payload. */
function redactForSave(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 40)}...[${value.length} chars]` : value;
  }
  if (Array.isArray(value)) return value.map(redactForSave);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactForSave(v)]));
  }
  return value;
}

async function generate(
  apiKey: string,
  keys: typeof ALL_KEYS,
  opts: { seed: number | null; steps: number },
): Promise<number> {
  await mkdir(RAW_DIR, { recursive: true });
  let failures = 0;
  for (const key of keys) {
    // A fixed seed per product keeps runs repeatable; --seed picks a new one for a regeneration.
    const seed = opts.seed ?? IMAGE_SEEDS[key] ?? BASE_SEED + ALL_KEYS.indexOf(key);
    const body = {
      prompt: imagePrompt(IMAGE_SUBJECTS[key]),
      width: SIZE,
      height: SIZE,
      seed,
      steps: opts.steps,
    };
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      const json: unknown = JSON.parse(text);
      await writeFile(
        join(RAW_DIR, `${key.toLowerCase()}.response.json`),
        JSON.stringify(redactForSave(json), null, 2),
      );
      const b64 = extractBase64(json);
      if (!b64) {
        const keysSeen = json && typeof json === 'object' ? Object.keys(json) : [];
        throw new Error(`no image field in response; top-level keys: ${keysSeen.join(', ')}`);
      }
      await writeFile(join(RAW_DIR, `${key.toLowerCase()}.png`), Buffer.from(b64, 'base64'));
      console.log(`${key}: saved ${key.toLowerCase()}.png (seed ${seed}, steps ${opts.steps})`);
    } catch (err) {
      failures++;
      console.error(`${key}: failed - ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
  return failures;
}

/** Shrinks each approved raw picture to 512 x 512 WebP of at most 200 KB. */
async function compress(keys: typeof ALL_KEYS): Promise<number> {
  await mkdir(ASSET_DIR, { recursive: true });
  let failures = 0;
  for (const key of keys) {
    try {
      const raw = await readFile(join(RAW_DIR, `${key.toLowerCase()}.png`));
      let out: Buffer = Buffer.alloc(0);
      let quality = 85;
      for (; quality >= 20; quality -= 5) {
        out = await sharp(raw)
          .resize(OUT_SIZE, OUT_SIZE, { fit: 'cover' })
          .webp({ quality })
          .toBuffer();
        if (out.length <= MAX_BYTES) break;
      }
      if (out.length > MAX_BYTES) throw new Error('still over 200 KB at the lowest quality');
      await writeFile(join(ASSET_DIR, imageKeyFor(key)), out);
      console.log(
        `${key}: ${imageKeyFor(key)} ${Math.round(out.length / 1024)} KB (quality ${quality})`,
      );
    } catch (err) {
      failures++;
      console.error(`${key}: failed - ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const keys = selectedKeys(args);
  if (args.has('compress')) {
    process.exitCode = (await compress(keys)) ? 1 : 0;
    return;
  }
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey || /^<.*>$/.test(apiKey)) throw new Error('NVIDIA_API_KEY is not set in .env.local.');
  const seedArg = args.get('seed');
  const stepsArg = args.get('steps');
  const seed = typeof seedArg === 'string' ? Number(seedArg) : null;
  const steps = typeof stepsArg === 'string' ? Number(stepsArg) : DEFAULT_STEPS;
  if (
    (seed !== null && !Number.isInteger(seed)) ||
    !Number.isInteger(steps) ||
    steps < 1 ||
    steps > MAX_STEPS
  ) {
    throw new Error(
      '--seed must be a whole number and --steps a whole number from 1 to 4 (the endpoint rejects more).',
    );
  }
  process.exitCode = (await generate(apiKey, keys, { seed, steps })) ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'image generation failed.');
  process.exit(1);
});
