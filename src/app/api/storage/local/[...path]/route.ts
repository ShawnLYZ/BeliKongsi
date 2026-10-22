import { isSafeKey, type LocalStorage } from '@/server/adapters/storage/local';
import { route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const notFound = () => new Response(null, { status: 404 });

const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** Serves product pictures from local storage in development. Other buckets are never public. */
export const GET = route({ auth: 'public' }, async ({ deps, params }) => {
  if (deps.env.STORAGE_ADAPTER !== 'local') return notFound();
  const path = params.path ?? '';
  const slash = path.indexOf('/');
  if (slash < 0 || path.slice(0, slash) !== 'product-images') return notFound();
  const key = path.slice(slash + 1);
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const contentType = TYPES[ext];
  if (!isSafeKey(key) || !contentType) return notFound();

  const bytes = await (deps.storage as LocalStorage).getObject('product-images', key);
  if (!bytes) return notFound();
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
});
