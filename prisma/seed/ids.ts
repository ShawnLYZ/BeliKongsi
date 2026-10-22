import { createHash } from 'node:crypto';

export const SEED_NAMESPACE = '6f1c2a4e-8b7d-4c3e-9a51-2d0e7b6c5f84';

export type SeedUserKey =
  'ahSeng' | 'rahim' | 'siti' | 'kumar' | 'mei' | 'danial' | 'farid' | 'lim' | 'priya' | 'nadia';

/** UUID version 5 (RFC 4122 section 4.3): SHA-1 of the namespace bytes followed by the name. */
export function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1').update(namespaceBytes).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The same kind and key always give the same id, so tests can assert on seeded rows (R9). */
export function seedId(kind: string, key: string): string {
  return uuidv5(`${kind}:${key}`, SEED_NAMESPACE);
}
