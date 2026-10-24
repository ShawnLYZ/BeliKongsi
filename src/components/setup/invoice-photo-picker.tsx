'use client';

import { useId, useRef } from 'react';
import { BUTTON_SECONDARY } from '@/components/common/controls';

const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;
const UNREADABLE = "We couldn't open that photo. Please choose a different one.";

/** Draws any browser-readable image onto a canvas and returns it as base64 JPEG (no data: prefix). */
async function toJpegBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    return url.slice(url.indexOf(',') + 1);
  } finally {
    bitmap.close();
  }
}

/**
 * Lets the owner choose or take a photo of an old invoice. Any image is turned into a JPEG of at
 * most 2,000 px before upload, so phone formats such as HEIC work and the file stays small.
 */
export function InvoicePhotoPicker({
  disabled,
  onPicked,
  onError,
}: {
  disabled?: boolean;
  onPicked: (imageBase64: string, mimeType: 'image/jpeg') => void;
  onError: (message: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  async function chosen(file: File | undefined) {
    if (!file) return;
    try {
      onPicked(await toJpegBase64(file), 'image/jpeg');
    } catch {
      onError(UNREADABLE);
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept="image/*"
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void chosen(e.target.files?.[0])}
      />
      <button
        type="button"
        className={BUTTON_SECONDARY}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onClick={() => input.current?.click()}
      >
        Use a photo of an old invoice instead
      </button>
      <p id={`${id}-hint`} className="text-muted-foreground text-base">
        Cover names and phone numbers before taking the photo.
      </p>
    </div>
  );
}
