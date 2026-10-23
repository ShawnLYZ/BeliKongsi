import { isSafeKey, type LocalStorage } from '@/server/adapters/storage/local';
import { route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const notFound = () => new Response(null, { status: 404 });
const refuse = (status: number, code: string, message: string) =>
  Response.json({ code, message }, { status });

const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** Splits `bucket/key...` and checks the key is a plain path. */
function target(path: string) {
  const slash = path.indexOf('/');
  if (slash < 0) return null;
  const bucket = path.slice(0, slash);
  const key = path.slice(slash + 1);
  if (bucket !== 'product-images' && bucket !== 'delivery-photos') return null;
  return isSafeKey(key) ? { bucket, key } : null;
}

/** The signed parts of a link, or null when any is missing or malformed. */
function signedParts(url: URL) {
  const q = url.searchParams;
  const exp = Number(q.get('exp'));
  const max = Number(q.get('max'));
  const sig = q.get('sig');
  const op = q.get('op');
  if (!sig || !Number.isInteger(exp) || !Number.isInteger(max)) return null;
  if (op !== 'put' && op !== 'get') return null;
  return { op, exp, max, sig, ct: q.get('ct') ?? '' };
}

const EXPIRED = ['FORBIDDEN', 'This link is not valid or has expired.'] as const;

/**
 * Serves product pictures publicly from local storage in development. Delivery photos are served
 * only through a signed, unexpired link (the signature is the credential).
 */
export const GET = route({ auth: 'public' }, async ({ request, deps, params }) => {
  if (deps.env.STORAGE_ADAPTER !== 'local') return notFound();
  const t = target(params.path ?? '');
  if (!t) return notFound();
  const storage = deps.storage as LocalStorage;

  if (t.bucket === 'delivery-photos') {
    const parts = signedParts(new URL(request.url));
    if (!parts) return notFound();
    if (parts.op !== 'get' || !storage.verifySigned('get', t.bucket, t.key, parts)) {
      return refuse(403, ...EXPIRED);
    }
    const [bytes, stat] = await Promise.all([
      storage.getObject(t.bucket, t.key),
      storage.statObject(t.bucket, t.key),
    ]);
    if (!bytes || !stat) return notFound();
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': stat.contentType,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const ext = t.key.slice(t.key.lastIndexOf('.') + 1).toLowerCase();
  const contentType = TYPES[ext];
  if (!contentType) return notFound();
  const bytes = await storage.getObject('product-images', t.key);
  if (!bytes) return notFound();
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
});

/** Receives an upload to a signed link; the signature fixes the key, type and largest size. */
export const PUT = route(
  { auth: 'public', maxBodyBytes: 8 * 1024 * 1024 },
  async ({ request, deps, params }) => {
    if (deps.env.STORAGE_ADAPTER !== 'local') return notFound();
    const t = target(params.path ?? '');
    if (!t || t.bucket !== 'delivery-photos') return notFound();
    const parts = signedParts(new URL(request.url));
    const storage = deps.storage as LocalStorage;
    if (!parts || parts.op !== 'put' || !storage.verifySigned('put', t.bucket, t.key, parts)) {
      return refuse(403, ...EXPIRED);
    }
    if ((request.headers.get('content-type') ?? '') !== parts.ct) {
      return refuse(422, 'UNSUPPORTED_TYPE', 'The photo type does not match the upload link.');
    }
    // Evidence is write-once: a second upload to the same link would replace a photo.
    if (await storage.statObject(t.bucket, t.key)) {
      return refuse(409, 'ALREADY_UPLOADED', 'This photo has already been uploaded.');
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > parts.max) {
      return refuse(422, 'TOO_LARGE', 'The photo is bigger than the upload link allows.');
    }
    await storage.putObject(t.bucket, t.key, bytes, parts.ct);
    return new Response(null, { status: 200 });
  },
);
