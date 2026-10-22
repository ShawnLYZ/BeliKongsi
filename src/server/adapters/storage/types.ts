export type Bucket = 'product-images' | 'delivery-photos';

export interface StorageAdapter {
  /** Product pictures are the only public bucket. */
  publicUrl(bucket: 'product-images', key: string): string;
  putObject(bucket: Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
