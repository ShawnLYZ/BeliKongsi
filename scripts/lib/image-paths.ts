import { IMAGE_SUBJECTS } from '../../prisma/seed/image-subjects';
import type { ProductKey } from '../../prisma/seed/catalogue';

export const RAW_DIR = '.data/images/raw';
export const ASSET_DIR = 'prisma/seed/assets/products';
export const SHEET_PATH = '.data/images/contact-sheet.html';

export const ALL_KEYS = Object.keys(IMAGE_SUBJECTS) as ProductKey[];

/** Reads `--name value` and `--flag` options; no positional arguments are used. */
export function parseArgs(argv: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.set(arg.slice(2), next);
      i++;
    } else {
      out.set(arg.slice(2), true);
    }
  }
  return out;
}

/** `--only CM,EGG_A` narrows to the named keys; no option means all twelve. */
export function selectedKeys(args: Map<string, string | true>): ProductKey[] {
  const only = args.get('only');
  if (typeof only !== 'string') return ALL_KEYS;
  const keys = only.split(',').map((k) => k.trim().toUpperCase());
  const unknown = keys.filter((k) => !ALL_KEYS.includes(k as ProductKey));
  if (unknown.length) {
    throw new Error(`Unknown product key(s): ${unknown.join(', ')}. Known: ${ALL_KEYS.join(', ')}`);
  }
  return keys as ProductKey[];
}
