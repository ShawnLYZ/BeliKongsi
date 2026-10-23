'use client';

import { useId } from 'react';
import { Camera, Images, X } from 'lucide-react';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BUTTON_SECONDARY, FIELD_ERROR } from '@/components/common/controls';
import { cn } from '@/lib/utils';

export const MAX_PHOTOS = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** One photo on a problem line: `photoId` is set once the server has asked for it. */
export type PickedPhoto = {
  key: string;
  photoId: string | null;
  name: string;
  previewUrl: string;
  /** 0 to 100. */
  progress: number;
  done: boolean;
  error: string | null;
};

type Upload = { url: string; method: 'PUT'; headers: Record<string, string> };

function putFile(upload: Upload, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('upload failed'));
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
}

/**
 * Up to 3 photos for one problem line (story 79): take one with the camera or pick from the
 * gallery. Each photo asks the server for a signed upload link, then sends the file to it while
 * showing progress. The parent owns the list so it can send the finished photo ids with the check.
 */
export function PhotoPicker({
  pickupId,
  label,
  photos,
  onChange,
}: {
  pickupId: string;
  label: string;
  photos: PickedPhoto[];
  onChange: (update: (previous: PickedPhoto[]) => PickedPhoto[]) => void;
}) {
  const id = useId();
  const full = photos.length >= MAX_PHOTOS;
  const patch = (key: string, change: Partial<PickedPhoto>) =>
    onChange((prev) => prev.map((p) => (p.key === key ? { ...p, ...change } : p)));

  async function add(file: File) {
    const key = crypto.randomUUID();
    const base: PickedPhoto = {
      key,
      photoId: null,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      done: false,
      error: null,
    };
    if (!TYPES.includes(file.type)) {
      onChange((prev) => [...prev, { ...base, error: 'Use a JPEG, PNG or WebP picture.' }]);
      return;
    }
    if (file.size > MAX_BYTES) {
      onChange((prev) => [...prev, { ...base, error: 'That picture is over 5 MB.' }]);
      return;
    }
    onChange((prev) => [...prev, base]);
    try {
      const { photoId, upload } = await apiFetch<{ photoId: string; upload: Upload }>(
        `/api/pickups/${pickupId}/photos`,
        { method: 'POST', body: { contentType: file.type, sizeBytes: file.size }, quiet: true },
      );
      patch(key, { photoId });
      await putFile(upload, file, (progress) => patch(key, { progress }));
      patch(key, { progress: 100, done: true });
    } catch (e) {
      patch(key, {
        error:
          e instanceof ApiError
            ? e.message
            : 'The picture did not upload. Remove it and try again.',
      });
    }
  }

  function remove(photo: PickedPhoto) {
    URL.revokeObjectURL(photo.previewUrl);
    onChange((prev) => prev.filter((p) => p.key !== photo.key));
  }

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS - photos.length)) {
      void add(file);
    }
    e.target.value = '';
  };
  const pickerButton = cn(
    BUTTON_SECONDARY,
    'focus-within:ring-ring/60 flex-1 cursor-pointer focus-within:ring-3',
    full && 'pointer-events-none opacity-60',
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-medium">{label}</p>
      <div className="flex gap-2">
        <label className={pickerButton}>
          <Camera aria-hidden="true" className="size-5" />
          Take a photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={full}
            onChange={choose}
            className="sr-only"
          />
        </label>
        <label className={pickerButton}>
          <Images aria-hidden="true" className="size-5" />
          From gallery
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={full}
            onChange={choose}
            className="sr-only"
          />
        </label>
      </div>
      <p className="text-muted-foreground text-base">
        Up to {MAX_PHOTOS} photos. <span className="tabular-nums">{photos.length}</span> added.
      </p>
      {photos.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {photos.map((p, i) => (
            <li key={p.key} className="bg-card flex items-center gap-3 rounded-xl border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt={`Photo ${i + 1} you added`}
                className="size-16 shrink-0 rounded-lg object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {p.error ? (
                  <p role="alert" className={FIELD_ERROR}>
                    {p.error}
                  </p>
                ) : p.done ? (
                  <p className="text-base font-medium">Uploaded</p>
                ) : (
                  <>
                    <label htmlFor={`${id}-${p.key}`} className="text-base">
                      Uploading <span className="tabular-nums">{p.progress}%</span>
                    </label>
                    <progress
                      id={`${id}-${p.key}`}
                      max={100}
                      value={p.progress}
                      className="h-2 w-full"
                    />
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(p)}
                aria-label={`Remove photo ${i + 1}`}
                className="hover:bg-muted focus-visible:ring-ring/60 inline-flex size-12 shrink-0 items-center justify-center rounded-xl outline-none focus-visible:ring-3"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
