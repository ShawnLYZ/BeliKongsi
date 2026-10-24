'use client';

import { useState } from 'react';
import type { ParseView } from '@/lib/views/usual-list';
import { SAMPLE_ORDER_TEXT } from '../../../prisma/seed/sample-order';
import { ApiError, apiFetch } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_QUIET,
  BUTTON_SECONDARY,
  FIELD_LABEL,
} from '@/components/common/controls';
import { DataNotice } from './data-notice';
import { InvoicePhotoPicker } from './invoice-photo-picker';

const MAX_CHARS = 2000;
const AI_UNAVAILABLE_MESSAGE =
  "We couldn't read your order right now. Use the catalogue form instead.";

type Failure = { message: string; canUseSavedExample: boolean; offerForm: boolean };

/** Setup step 1a: the data notice, then the paste box. */
export function PasteStep({
  shopId,
  onRead,
  onUseForm,
}: {
  shopId: string;
  onRead: (view: ParseView) => void;
  onUseForm: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function read(useSavedExample: boolean, photo?: { imageBase64: string; mimeType: string }) {
    if (!photo && !useSavedExample && text.trim() === '') {
      setFailure({
        message: 'Paste an order first, or try with sample data.',
        canUseSavedExample: false,
        offerForm: false,
      });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const view = photo
        ? await apiFetch<ParseView>(`/api/shops/${shopId}/usual-list/parse-photo`, {
            body: photo,
            quiet: true,
          })
        : await apiFetch<ParseView>(`/api/shops/${shopId}/usual-list/parse`, {
            body: { text, ...(useSavedExample ? { useSavedExample: true } : {}) },
            quiet: true,
          });
      if (view.lines.length === 0) {
        setFailure({
          message: photo
            ? "We couldn't find any items in this photo. Try a clearer photo, paste the order instead, or use the catalogue form."
            : "We couldn't find any products we sell in that text. Check it and try again, or use the catalogue form instead.",
          canUseSavedExample: false,
          offerForm: true,
        });
        setBusy(false);
        return;
      }
      onRead(view);
    } catch (error) {
      const e = error instanceof ApiError ? error : null;
      if (e?.code === 'AI_UNAVAILABLE') {
        const details = e.details as { canUseSavedExample?: boolean } | undefined;
        setFailure({
          message: AI_UNAVAILABLE_MESSAGE,
          canUseSavedExample: details?.canUseSavedExample === true,
          offerForm: true,
        });
      } else {
        setFailure({
          message: e?.message ?? 'Something went wrong. Please try again.',
          canUseSavedExample: false,
          offerForm: e?.code === 'RATE_LIMITED',
        });
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Paste your usual order</h2>
        <p className="text-base">
          Paste an old WhatsApp order to your supplier. BeliKongsi reads it and builds your usual
          list. You check every line before anything is saved.
        </p>
      </div>
      <DataNotice />
      <div className="flex flex-col gap-2">
        <label htmlFor="paste-order" className={FIELD_LABEL}>
          Your order message
        </label>
        <textarea
          id="paste-order"
          rows={8}
          maxLength={MAX_CHARS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'e.g.\n炼奶 4箱\nminyak 1 tin\ntelur A 10 papan\ncawan 16oz 2 ctn'}
          aria-describedby="paste-order-count"
          className="border-input/60 bg-card focus-visible:border-ring focus-visible:ring-ring/60 w-full rounded-xl border-2 p-3 text-base outline-none focus-visible:ring-3"
        />
        <p id="paste-order-count" className="text-muted-foreground text-base tabular-nums">
          {text.length.toLocaleString('en')} of {MAX_CHARS.toLocaleString('en')} characters
        </p>
      </div>

      {failure ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-2xl border-2 p-4"
        >
          <p className="text-base font-medium">{failure.message}</p>
          {failure.canUseSavedExample ? (
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={busy}
              onClick={() => read(true)}
            >
              Use saved example
            </button>
          ) : null}
          {failure.offerForm ? (
            <button type="button" className={BUTTON_SECONDARY} onClick={onUseForm}>
              Use the catalogue form instead
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={busy}
          onClick={() => read(false)}
        >
          {busy ? 'Reading your order…' : 'Read my order'}
        </button>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={busy}
          onClick={() => {
            setText(SAMPLE_ORDER_TEXT);
            setFailure(null);
          }}
        >
          Try with sample data
        </button>
        <InvoicePhotoPicker
          disabled={busy}
          onPicked={(imageBase64, mimeType) => void read(false, { imageBase64, mimeType })}
          onError={(message) =>
            setFailure({ message, canUseSavedExample: false, offerForm: false })
          }
        />
        <button type="button" className={BUTTON_QUIET} onClick={onUseForm}>
          Use the catalogue form instead
        </button>
      </div>
    </div>
  );
}
