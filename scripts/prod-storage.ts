import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { exitOnError, requireEnv } from './lib/prod-env';
import { ensureBuckets } from './lib/storage-buckets';

const ASSET_DIR = 'prisma/seed/assets/products';
const env = requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');

async function main(): Promise<void> {
  const client = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  for (const line of await ensureBuckets(client.storage)) console.log(line);

  const files = (await readdir(ASSET_DIR)).filter((f) => f.endsWith('.webp')).sort();
  for (const file of files) {
    const bytes = await readFile(join(ASSET_DIR, file));
    const { error } = await client.storage
      .from('product-images')
      .upload(file, bytes, { contentType: 'image/webp', upsert: true });
    if (error) throw new Error(`Upload of ${file} failed: ${error.message}`);
  }
  console.log(`Uploaded ${files.length} product images to product-images.`);
}

main().catch(exitOnError('prod:storage'));
