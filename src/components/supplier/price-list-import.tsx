'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Info } from 'lucide-react';
import type { PriceListParseView } from '@/lib/views/supplier';
import { SAMPLE_PRICE_LIST_TEXT } from '../../../prisma/seed/sample-price-list';
import { ApiError, apiFetch } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_QUIET,
  BUTTON_SECONDARY,
  FIELD_LABEL,
} from '@/components/common/controls';
import { cn } from '@/lib/utils';
import { PriceListReview } from './price-list-review';

const MAX_CHARS = 8000;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type Photo = { name: string; mimeType: string; base64: string };
type Stage =
  | { step: 'input' }
  | { step: 'review'; parse: PriceListParseView; attempt: number }
  | { step: 'done'; updated: number; created: number };

/** The photo's bytes as base64 (no `data:` prefix), read in the browser. It is never stored. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function InputStep({
  supplierId,
  onRead,
}: {
  supplierId: string;
  onRead: (view: PriceListParseView) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [sample, setSample] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function choosePhoto(file: File) {
    setFailure(null);
    if (!PHOTO_TYPES.includes(file.type)) {
      setFailure('Please choose a JPEG, PNG or WebP photo.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setFailure('That photo is bigger than 5 MB. Please choose a smaller one.');
      return;
    }
    try {
      setPhoto({ name: file.name, mimeType: file.type, base64: await readAsBase64(file) });
    } catch {
      setFailure('That photo could not be read. Please try another.');
    }
  }

  async function read() {
    if (text.trim() === '' && !photo) {
      setFailure('Paste a price list or add a photo first, or try with sample data.');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const view = await apiFetch<PriceListParseView>(
        `/api/suppliers/${supplierId}/price-list/parse`,
        {
          body: {
            ...(text.trim() === '' ? {} : { text }),
            ...(photo ? { imageBase64: photo.base64, mimeType: photo.mimeType } : {}),
          },
          quiet: true,
        },
      );
      if (view.lines.length === 0) {
        setFailure(
          "We couldn't find any prices in that. Check it and try again, or change products one by one.",
        );
        setBusy(false);
        return;
      }
      onRead(view);
    } catch (error) {
      const e = error instanceof ApiError ? error : null;
      setFailure(
        e?.code === 'AI_UNAVAILABLE'
          ? "We couldn't read your price list right now. Please try again in a minute, or change products one by one."
          : (e?.message ?? 'Something went wrong. Please try again.'),
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby={`${id}-notice`}
        className="bg-card flex flex-col gap-2 rounded-2xl border p-4"
      >
        <h2 id={`${id}-notice`} className="flex items-center gap-2 text-lg font-semibold">
          <Info aria-hidden="true" className="text-primary size-5 shrink-0" />
          Before you start
        </h2>
        <p className="text-base font-medium">
          The photo is sent to our AI provider; cover any personal details.
        </p>
        <p className="text-base">
          In pasted text, phone numbers, email addresses and IC numbers are removed before the AI
          reads it. The photo is not kept.
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-text`} className={FIELD_LABEL}>
          Your price list
        </label>
        <textarea
          id={`${id}-text`}
          rows={8}
          maxLength={MAX_CHARS}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSample(false);
          }}
          placeholder={'e.g.\nSusu pekat manis 390g - harga sendiri RM168\n  20 ctn ke atas RM157'}
          aria-describedby={`${id}-count`}
          className="border-input/60 bg-card focus-visible:border-ring focus-visible:ring-ring/60 w-full rounded-xl border-2 p-3 text-base outline-none focus-visible:ring-3"
        />
        <p id={`${id}-count`} className="text-muted-foreground text-base tabular-nums">
          {text.length.toLocaleString('en')} of {MAX_CHARS.toLocaleString('en')} characters
        </p>
        {sample ? (
          <p className="text-base">
            <span className="bg-banner text-banner-foreground rounded-full px-2 font-semibold">
              Made-up data
            </span>{' '}
            A sample price list from a fictional supplier.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor={`${id}-photo`}
          className={cn(
            BUTTON_SECONDARY,
            'has-focus-visible:ring-ring/60 cursor-pointer has-focus-visible:ring-3',
          )}
        >
          {photo ? 'Choose a different photo' : 'Add a photo of a price list'}
          <input
            id={`${id}-photo`}
            type="file"
            accept={PHOTO_TYPES.join(',')}
            className="sr-only"
            aria-describedby={`${id}-photo-hint`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void choosePhoto(file);
            }}
          />
        </label>
        <p id={`${id}-photo-hint`} className="text-muted-foreground text-base">
          {photo ? `Photo added: ${photo.name}` : 'JPEG, PNG or WebP, up to 5 MB.'}
        </p>
        {photo ? (
          <button type="button" className={BUTTON_QUIET} onClick={() => setPhoto(null)}>
            Remove the photo
          </button>
        ) : null}
      </div>

      {failure ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 rounded-2xl border-2 p-4 text-base font-medium"
        >
          {failure}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={read}>
          {busy ? 'Reading your price list…' : 'Read price list'}
        </button>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={busy}
          onClick={() => {
            setText(SAMPLE_PRICE_LIST_TEXT);
            setSample(true);
            setFailure(null);
          }}
        >
          Try with sample data
        </button>
      </div>
    </div>
  );
}

/** Price-list import (P1-13): paste or photograph, check the drafted tiers, then confirm. */
export function PriceListImport({ supplierId }: { supplierId: string }) {
  const [stage, setStage] = useState<Stage>({ step: 'input' });
  const [attempts, setAttempts] = useState(0);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/supplier/products" className={`${BUTTON_QUIET} self-start px-0`}>
        ← All products
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Import a price list</h1>
        <p className="mt-1 text-base">
          Paste your price list or add a photo of it. BeliKongsi drafts the tiers for you to check.
          Nothing is saved until you confirm.
        </p>
      </div>

      {stage.step === 'input' ? (
        <InputStep
          supplierId={supplierId}
          onRead={(parse) => {
            setAttempts((n) => n + 1);
            setStage({ step: 'review', parse, attempt: attempts + 1 });
          }}
        />
      ) : null}

      {stage.step === 'review' ? (
        <PriceListReview
          key={stage.attempt}
          supplierId={supplierId}
          parse={stage.parse}
          onConfirmed={(r) => setStage({ step: 'done', ...r })}
          onStartOver={() => setStage({ step: 'input' })}
        />
      ) : null}

      {stage.step === 'done' ? (
        <section className="bg-card flex flex-col gap-4 rounded-2xl border p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <CheckCircle2 aria-hidden="true" className="text-primary size-6 shrink-0" />
            Price list saved
          </h2>
          <p className="text-base">
            {stage.updated} {stage.updated === 1 ? 'product' : 'products'} updated
            {stage.created > 0
              ? `, ${stage.created} new ${stage.created === 1 ? 'product' : 'products'} added`
              : ''}
            . New prices reach shops from each product&apos;s next round.
          </p>
          <Link href="/supplier/products" className={BUTTON_PRIMARY}>
            See your products
          </Link>
        </section>
      ) : null}
    </div>
  );
}
