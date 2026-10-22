import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('stores every product image as WebP of at most 200 KB', () => {
  for (const f of readdirSync('prisma/seed/assets/products')) {
    const b = readFileSync(join('prisma/seed/assets/products', f));
    expect(b.subarray(0, 4).toString()).toBe('RIFF');
    expect(b.subarray(8, 12).toString()).toBe('WEBP');
    expect(b.length).toBeLessThanOrEqual(200 * 1024);
  }
  expect(readdirSync('prisma/seed/assets/products')).toHaveLength(12);
});
