import { createClient } from '@supabase/supabase-js';
import type { StorageAdapter } from './types';

/** Supabase Storage with the service-role key; the key stays on the server. */
export function createSupabaseStorage(opts: {
  url: string;
  serviceRoleKey: string;
}): StorageAdapter {
  const base = opts.url.replace(/\/+$/, '');
  const client = createClient(base, opts.serviceRoleKey, { auth: { persistSession: false } });
  return {
    publicUrl: (bucket, key) => `${base}/storage/v1/object/public/${bucket}/${key}`,
    async putObject(bucket, key, bytes, contentType) {
      const { error } = await client.storage
        .from(bucket)
        .upload(key, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
    },
    // The SDK's signed upload URL has a fixed lifetime and cannot enforce size or type. Both
    // buckets carry their own 5 MB, JPEG/PNG/WebP-only limits (set by `pnpm prod:storage`), and
    // the server re-checks the stored object with statObject before using it.
    async createSignedUploadUrl(bucket, key, opts) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUploadUrl(key, { upsert: false });
      if (error) throw new Error(`Storage signing failed: ${error.message}`);
      return { url: data.signedUrl, method: 'PUT', headers: { 'content-type': opts.contentType } };
    },
    async createSignedReadUrl(bucket, key, expiresInSeconds) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(key, expiresInSeconds);
      if (error) throw new Error(`Storage signing failed: ${error.message}`);
      return data.signedUrl;
    },
    async statObject(bucket, key) {
      const slash = key.lastIndexOf('/');
      const dir = slash < 0 ? '' : key.slice(0, slash);
      const name = key.slice(slash + 1);
      const { data, error } = await client.storage.from(bucket).list(dir, { search: name });
      if (error) throw new Error(`Storage lookup failed: ${error.message}`);
      const found = data.find((o) => o.name === name);
      if (!found) return null;
      const meta = (found.metadata ?? {}) as { size?: number; mimetype?: string };
      return {
        sizeBytes: meta.size ?? 0,
        contentType: meta.mimetype ?? 'application/octet-stream',
      };
    },
    async deleteObject(bucket, key) {
      const { error } = await client.storage.from(bucket).remove([key]);
      if (error) throw new Error(`Storage delete failed: ${error.message}`);
    },
  };
}
