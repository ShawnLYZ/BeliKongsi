import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMAGE_SUBJECTS } from '../prisma/seed/image-subjects';
import { ALL_KEYS, RAW_DIR, SHEET_PATH } from './lib/image-paths';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function main(): Promise<void> {
  const cells = ALL_KEYS.map((key) => {
    const file = resolve(RAW_DIR, `${key.toLowerCase()}.png`);
    const src = esc(relative(dirname(resolve(SHEET_PATH)), file).replaceAll(/[\\]/g, '/'));
    const picture = existsSync(file)
      ? `<img src="${src}" alt="${esc(IMAGE_SUBJECTS[key])}" width="320" height="320">`
      : '<div class="missing">not generated yet</div>';
    return `<figure>${picture}<figcaption><strong>${key}</strong><br>${esc(IMAGE_SUBJECTS[key])}</figcaption></figure>`;
  });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Product image review</title>
<style>
body{font:16px/1.4 system-ui,sans-serif;margin:24px;background:#fafafa;color:#111}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:12px;padding:12px}
img,.missing{display:block;width:100%;height:auto;aspect-ratio:1;background:#eee;border-radius:8px}
.missing{display:grid;place-items:center;color:#555}
figcaption{margin-top:8px}
</style></head><body>
<h1>Product image review (${ALL_KEYS.length})</h1>
<p>Reject any picture showing text, logos or brand-like marks.</p>
<main>
${cells.join('\n')}
</main></body></html>
`;
  await mkdir(dirname(SHEET_PATH), { recursive: true });
  await writeFile(SHEET_PATH, html);
  console.log(`Wrote ${SHEET_PATH} (${pathToFileURL(resolve(SHEET_PATH)).href})`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'contact sheet failed.');
  process.exit(1);
});
