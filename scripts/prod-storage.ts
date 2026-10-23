import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { exitOnError, requireEnv } from './lib/prod-env';

const ASSET_DIR = 'prisma/seed/assets/products';
const env = requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');

async function main(): Promise<void> {
  const client = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: existing, error: listError } = await client.storage.listBuckets();
  if (listError) throw new Error(`Could not list buckets: ${listError.message}`);
  const have = new Set(existing.map((b) => b.name));

  const wanted = [
    { name: 'product-images', options: { public: true } },
    {
      name: 'delivery-photos',
      options: {
        public: false,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
    },
  ];
  for (const b of wanted) {
    if (have.has(b.name)) {
      console.log(`Bucket ${b.name}: already exists`);
      continue;
    }
    const { error } = await client.storage.createBucket(b.name, b.options);
    if (error) throw new Error(`Could not create bucket ${b.name}: ${error.message}`);
    console.log(`Bucket ${b.name}: created`);
  }

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
