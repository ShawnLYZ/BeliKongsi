'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { SupplierProductView } from '@/lib/views/supplier';
import { ProductImage } from '@/components/catalogue/product-image';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BUTTON_SECONDARY, FIELD_ERROR } from '@/components/common/controls';
import { cn } from '@/lib/utils';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

type Upload = { url: string; method: 'PUT'; headers: Record<string, string> };

/**
 * The product's photo: optional, with the category icon otherwise. A new photo asks for a signed
 * upload link, sends the file to it, then attaches it to the product.
 */
export function ProductPhoto({
  supplierId,
  product,
}: {
  supplierId: string;
  product: SupplierProductView;
}) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!TYPES.includes(file.type)) {
      setError('Please choose a JPEG, PNG or WebP photo.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That photo is bigger than 5 MB. Please choose a smaller one.');
      return;
    }
    setBusy(true);
    const base = `/api/suppliers/${supplierId}/products/${product.productId}`;
    try {
      const asked = await apiFetch<{ imageKey: string; upload: Upload }>(`${base}/image`, {
        body: { contentType: file.type, sizeBytes: file.size },
        quiet: true,
      });
      const put = await fetch(asked.upload.url, {
        method: asked.upload.method,
        headers: asked.upload.headers,
        body: file,
      });
      if (!put.ok) throw new Error('upload failed');
      await apiFetch(base, { method: 'PATCH', body: { imageKey: asked.imageKey }, quiet: true });
      toast.success('Photo saved.');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The photo did not upload. Please try again.');
    }
    setBusy(false);
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        Photo
      </h2>
      <div className="flex items-start gap-3">
        <ProductImage product={product} className="w-28 shrink-0" />
        <p className="text-base">
          {product.imageUrl
            ? 'Shops see this photo on the product.'
            : 'No photo yet: shops see the category icon. A photo is optional.'}
        </p>
      </div>
      <label
        htmlFor={`${id}-file`}
        className={cn(
          BUTTON_SECONDARY,
          'has-focus-visible:ring-ring/60 cursor-pointer has-focus-visible:ring-3',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        {busy ? 'Uploading…' : product.imageUrl ? 'Choose a new photo' : 'Add a photo'}
        <input
          id={`${id}-file`}
          type="file"
          accept={TYPES.join(',')}
          disabled={busy}
          className="sr-only"
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      <p id={`${id}-hint`} className="text-muted-foreground text-base">
        JPEG, PNG or WebP, up to 5 MB.
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
