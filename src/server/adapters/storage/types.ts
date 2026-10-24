export type Bucket = 'product-images' | 'delivery-photos';

export interface SignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StorageAdapter {
  /** Product pictures are the only public bucket. */
  publicUrl(bucket: 'product-images', key: string): string;
  putObject(bucket: Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** A short-lived link to upload one object of the given type, up to `maxBytes`, to a bucket. */
  createSignedUploadUrl(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; maxBytes: number; expiresInSeconds: number },
  ): Promise<SignedUpload>;
  /** A short-lived link to read one object from the private bucket. */
  createSignedReadUrl(
    bucket: 'delivery-photos',
    key: string,
    expiresInSeconds: number,
  ): Promise<string>;
  /** Size and type of a stored object, or null when nothing is stored there. */
  statObject(
    bucket: Bucket,
    key: string,
  ): Promise<{ sizeBytes: number; contentType: string } | null>;
  deleteObject(bucket: Bucket, key: string): Promise<void>;
}
