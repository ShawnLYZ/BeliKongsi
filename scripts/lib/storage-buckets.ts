/** Photo uploads in both buckets: JPEG, PNG or WebP of 5 MB or less, enforced by Storage itself. */
const PHOTO_LIMITS = {
  fileSizeLimit: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
};

export interface BucketOptions {
  public: boolean;
  fileSizeLimit: number;
  allowedMimeTypes: string[];
}

/**
 * The buckets production needs. `product-images` is public (owners see the pictures) but suppliers
 * upload to it through signed links, so it carries the same limits as `delivery-photos`.
 */
export const WANTED_BUCKETS: { name: string; options: BucketOptions }[] = [
  { name: 'product-images', options: { public: true, ...PHOTO_LIMITS } },
  { name: 'delivery-photos', options: { public: false, ...PHOTO_LIMITS } },
];

type Result = Promise<{ error: { message: string } | null }>;

/** The part of the Supabase Storage client that bucket setup uses. */
export interface BucketClient {
  listBuckets(): Promise<{ data: { name: string }[] | null; error: { message: string } | null }>;
  createBucket(name: string, options: BucketOptions): Result;
  updateBucket(name: string, options: BucketOptions): Result;
}

/**
 * Creates each wanted bucket, or brings an existing one's settings up to date, so re-running the
 * script also applies limits added later. Returns one line per bucket.
 */
export async function ensureBuckets(storage: BucketClient): Promise<string[]> {
  const { data, error: listError } = await storage.listBuckets();
  if (listError || !data) throw new Error(`Could not list buckets: ${listError?.message}`);
  const have = new Set(data.map((b) => b.name));
  const report: string[] = [];
  for (const b of WANTED_BUCKETS) {
    if (have.has(b.name)) {
      const { error } = await storage.updateBucket(b.name, b.options);
      if (error) throw new Error(`Could not update bucket ${b.name}: ${error.message}`);
      report.push(`Bucket ${b.name}: settings updated`);
    } else {
      const { error } = await storage.createBucket(b.name, b.options);
      if (error) throw new Error(`Could not create bucket ${b.name}: ${error.message}`);
      report.push(`Bucket ${b.name}: created`);
    }
  }
  return report;
}
