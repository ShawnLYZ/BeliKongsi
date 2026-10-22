import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Bucket, StorageAdapter } from './types';

export interface LocalStorage extends StorageAdapter {
  /** Reads a stored object, or null when the key is unsafe or nothing is stored there. */
  getObject(bucket: Bucket, key: string): Promise<Uint8Array | null>;
}

/** A key is safe when every segment is a plain name: no empty or dot-only parts, backslash or NUL. */
export function isSafeKey(key: string): boolean {
  if (!key || /[\\\0]/.test(key)) return false;
  return key.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Files under a local directory, for development and tests. `secret` is reserved for signed URLs. */
export function createLocalStorage(opts: { dir: string; secret?: string }): LocalStorage {
  const root = resolve(opts.dir);

  function pathFor(bucket: Bucket, key: string): string | null {
    if (!isSafeKey(key)) return null;
    const bucketDir = resolve(root, bucket);
    const file = resolve(bucketDir, key);
    return file.startsWith(bucketDir + sep) ? file : null;
  }

  return {
    publicUrl: (bucket, key) => `/api/storage/local/${bucket}/${key}`,
    async putObject(bucket, key, bytes) {
      const file = pathFor(bucket, key);
      if (!file) throw new Error('Invalid storage key.');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
    async getObject(bucket, key) {
      const file = pathFor(bucket, key);
      if (!file) return null;
      try {
        return await readFile(file);
      } catch {
        return null;
      }
    },
  };
}
