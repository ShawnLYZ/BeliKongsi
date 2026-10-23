import { describe, expect, it } from 'vitest';
import { scanChunk } from '../../scripts/lib/bundle-scan';

const KEYS = ['DATABASE_URL', 'SESSION_SECRET'];
const scan = (c: string) => scanChunk('chunk.js', c, KEYS);

describe('scanChunk', () => {
  it('passes a clean minified chunk', () => {
    expect(scan('function a(){return pg+1}var DATABASE_URL_X=1;export{a}')).toEqual([]);
  });
  it('flags a server env name as a whole word', () => {
    expect(scan('x=process.env.SESSION_SECRET;')).toEqual([
      { path: 'chunk.js', kind: 'server-env-name', detail: 'SESSION_SECRET' },
    ]);
  });
  it('flags key patterns but not the Google Maps key', () => {
    const nvidia = `k="nvapi-${'a'.repeat(45)}"`;
    expect(scan(nvidia).map((f) => f.detail)).toEqual(['nvidia-key']);
    expect(scan(`k="AIza${'b'.repeat(35)}"`)).toEqual([]);
  });
  it('flags server-only package markers', () => {
    expect(scan('require("@prisma/client")').map((f) => f.detail)).toContain(
      '@prisma/client (marker @prisma/client)',
    );
    expect(scan('import "@supabase/supabase-js"').length).toBeGreaterThan(0);
    expect(scan('/node_modules/pg/lib/index.js').map((f) => f.kind)).toEqual(['server-package']);
  });
});
