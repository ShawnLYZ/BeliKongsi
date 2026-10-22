import { describe, expect, it } from 'vitest';
import { SEED_NAMESPACE, seedId, uuidv5 } from '../../prisma/seed/ids';

describe('seed ids', () => {
  it('implements UUID v5 (Python documentation vector)', () => {
    expect(uuidv5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d',
    );
  });

  it('derives a seed id from the kind and the key', () => {
    expect(seedId('product', 'CM')).toBe(uuidv5('product:CM', SEED_NAMESPACE));
  });

  it('gives different kinds with the same key different ids', () => {
    expect(seedId('shop', 'OPS')).not.toBe(seedId('operator', 'OPS'));
  });

  it('gives the same id every time', () => {
    expect(seedId('shop', 'KEDAI_KOPI')).toBe(seedId('shop', 'KEDAI_KOPI'));
  });
});
