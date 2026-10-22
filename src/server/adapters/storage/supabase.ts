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
  };
}
