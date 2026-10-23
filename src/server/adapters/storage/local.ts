import { systemClock } from '@/server/adapters/clock';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Bucket, StorageAdapter } from './types';

export interface LocalStorage extends StorageAdapter {
  /** Reads a stored object, or null when the key is unsafe or nothing is stored there. */
  getObject(bucket: Bucket, key: string): Promise<Uint8Array | null>;
  /** True when `sig` matches the operation and the link has not expired by the storage clock. */
  verifySigned(
    op: 'put' | 'get',
    bucket: Bucket,
    key: string,
    parts: { exp: number; ct: string; max: number; sig: string },
  ): boolean;
}

/** A key is safe when every segment is a plain name: no empty or dot-only parts, backslash or NUL. */
export function isSafeKey(key: string): boolean {
  if (!key || /[\\\0]/.test(key)) return false;
  return key.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Files under a local directory, for development and tests. `now` is the app clock (G4). */
export function createLocalStorage(opts: {
  dir: string;
  secret?: string;
  now?: () => Date;
}): LocalStorage {
  const root = resolve(opts.dir);
  const now = opts.now ?? (() => systemClock.now());
  const secret = opts.secret ?? '';

  const sign = (op: string, bucket: string, key: string, exp: number, ct: string, max: number) =>
    createHmac('sha256', secret)
      .update([op, bucket, key, exp, ct, max].join('|'))
      .digest('base64url');
  const expiry = (seconds: number) => Math.floor(now().getTime() / 1000) + seconds;
  const signedPath = (
    op: 'put' | 'get',
    bucket: Bucket,
    key: string,
    exp: number,
    ct: string,
    max: number,
  ) =>
    `/api/storage/local/${bucket}/${key}?op=${op}&exp=${exp}&ct=${encodeURIComponent(ct)}` +
    `&max=${max}&sig=${sign(op, bucket, key, exp, ct, max)}`;

  function pathFor(bucket: Bucket, key: string): string | null {
    if (!isSafeKey(key)) return null;
    const bucketDir = resolve(root, bucket);
    const file = resolve(bucketDir, key);
    return file.startsWith(bucketDir + sep) ? file : null;
  }

  // Content types live beside the buckets, never inside one.
  const metaFor = (bucket: Bucket, key: string) => resolve(root, '.meta', bucket, `${key}.json`);

  return {
    publicUrl: (bucket, key) => `/api/storage/local/${bucket}/${key}`,
    async putObject(bucket, key, bytes, contentType) {
      const file = pathFor(bucket, key);
      if (!file) throw new Error('Invalid storage key.');
      await mkdir(/* turbopackIgnore: true */ dirname(file), { recursive: true });
      await writeFile(/* turbopackIgnore: true */ file, bytes);
      const meta = metaFor(bucket, key);
      await mkdir(/* turbopackIgnore: true */ dirname(meta), { recursive: true });
      await writeFile(/* turbopackIgnore: true */ meta, JSON.stringify({ contentType }));
    },
    async getObject(bucket, key) {
      const file = pathFor(bucket, key);
      if (!file) return null;
      try {
        return await readFile(/* turbopackIgnore: true */ file);
      } catch {
        return null;
      }
    },
    async createSignedUploadUrl(bucket, key, o) {
      if (!pathFor(bucket, key)) throw new Error('Invalid storage key.');
      const exp = expiry(o.expiresInSeconds);
      return {
        url: signedPath('put', bucket, key, exp, o.contentType, o.maxBytes),
        method: 'PUT',
        headers: { 'content-type': o.contentType },
      };
    },
    async createSignedReadUrl(bucket, key, expiresInSeconds) {
      if (!pathFor(bucket, key)) throw new Error('Invalid storage key.');
      return signedPath('get', bucket, key, expiry(expiresInSeconds), '', 0);
    },
    verifySigned(op, bucket, key, parts) {
      const expected = Buffer.from(sign(op, bucket, key, parts.exp, parts.ct, parts.max));
      const given = Buffer.from(parts.sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
      return now().getTime() / 1000 <= parts.exp;
    },
    async statObject(bucket, key) {
      const file = pathFor(bucket, key);
      if (!file) return null;
      try {
        const info = await stat(/* turbopackIgnore: true */ file);
        let contentType = 'application/octet-stream';
        try {
          const meta = JSON.parse(
            await readFile(/* turbopackIgnore: true */ metaFor(bucket, key), 'utf8'),
          ) as {
            contentType: string;
          };
          contentType = meta.contentType;
        } catch {
          // No sidecar: keep the default type.
        }
        return { sizeBytes: info.size, contentType };
      } catch {
        return null;
      }
    },
    async deleteObject(bucket, key) {
      const file = pathFor(bucket, key);
      if (!file) return;
      await rm(/* turbopackIgnore: true */ file, { force: true });
      await rm(/* turbopackIgnore: true */ metaFor(bucket, key), { force: true });
    },
  };
}
