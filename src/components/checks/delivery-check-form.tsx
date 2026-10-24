'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import type { PickupCollectionView, PickupLineView, PickupView } from '@/lib/views/pickups';
import { ProductImage } from '@/components/catalogue/product-image';
import { ApiError, apiFetch } from '@/components/common/api-client';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_ERROR,
  FIELD_LABEL,
} from '@/components/common/controls';
import { QuantityStepper } from '@/components/common/quantity-stepper';
import { formatMyt, formatUnits } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PhotoPicker, type PickedPhoto } from './photo-picker';

type Issue = { missing: number | null; damaged: number | null };
type Result = { result: 'all_received' | 'issues' | 'not_checked'; claimId: string | null };

/** The check window: 72 hours after the goods were handed over (P1-10). */
const CHECK_WINDOW_MS = 72 * 60 * 60 * 1000;

const count = (v: number | null | undefined) => v ?? 0;

function DonePanel({
  result,
  claimHref,
  partLabel,
}: {
  partLabel: string | null;
  result: 'all_received' | 'issues' | 'not_checked';
  claimHref: string | null;
}) {
  return (
    <section
      role="status"
      className="border-primary bg-primary/10 flex flex-col gap-2 rounded-2xl border-2 p-5"
    >
      <p className="flex items-center gap-3 text-xl font-bold">
        <CheckCircle2 aria-hidden="true" className="text-primary size-8 shrink-0" />
        {result === 'not_checked' ? 'Received, not checked' : 'Done'}
        {partLabel ? ` (${partLabel})` : ''}
      </p>
      <p className="text-base">
        {result === 'all_received'
          ? 'Thank you. You told us everything arrived.'
          : result === 'not_checked'
            ? 'The 72 hours to check these goods have passed, so no claim can be sent for them.'
            : 'Thank you. We sent your report to BeliKongsi. We will tell you when it has been reviewed.'}
      </p>
      {result === 'issues' && claimHref ? (
        <Link href={claimHref} className={cn(BUTTON_SECONDARY, 'self-start')}>
          See your claim
        </Link>
      ) : null}
    </section>
  );
}

function LineHead({ line }: { line: PickupLineView }) {
  return (
    <div className="flex items-center gap-3">
      <ProductImage
        product={{
          name: line.productName,
          category: line.category,
          imageUrl: line.imageUrl,
          imageAiGenerated: line.imageAiGenerated,
        }}
        className="w-28 shrink-0 self-start"
      />
      <div className="min-w-0">
        <p className="text-base font-semibold">{line.productName}</p>
        <p className="text-muted-foreground text-base tabular-nums">
          Expected {formatUnits(line.quantity, line.unitName)}
        </p>
      </div>
    </div>
  );
}

/**
 * The delivery check after the goods are handed over (PRD §10-11, stories 77-81), for staff and
 * owners. "All received" closes the pickup; "Report a problem" asks for missing and damaged units
 * per line, with up to 3 photos each. No prices appear anywhere in this flow.
 */
export function DeliveryCheckForm({
  pickup,
  collection,
  partLabel,
  claimBase,
}: {
  pickup: PickupView;
  /** The hand-over this check is for (O7: one check per collection). */
  collection: PickupCollectionView;
  /** "Part 2" when the pickup was collected in several parts; null for a single collection. */
  partLabel: string | null;
  /** The owner's claim screen path, such as `/owner/claims`; staff pass null (no claim page). */
  claimBase: string | null;
}) {
  const claimHref = (claimId: string) => (claimBase ? `${claimBase}/${claimId}` : null);
  const id = useId();
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  const [photos, setPhotos] = useState<Record<string, PickedPhoto[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineError, setLineError] = useState<{ allocationId: string; message: string } | null>(
    null,
  );
  const [result, setResult] = useState<Result | null>(null);

  if (!pickup.pickupId) return null;
  const pickupId = pickup.pickupId;
  const lines = collection.lines.filter((l) => l.allocationId !== null);
  const deadline = new Date(new Date(collection.collectedAt).getTime() + CHECK_WINDOW_MS);
  const title = partLabel ? `Check your goods (${partLabel})` : 'Check your goods';

  if (result) {
    return (
      <DonePanel
        result={result.result}
        claimHref={result.claimId ? claimHref(result.claimId) : null}
        partLabel={partLabel}
      />
    );
  }
  if (collection.checked) {
    return (
      <DonePanel
        result={collection.checkResult ?? (collection.claimId ? 'issues' : 'all_received')}
        claimHref={collection.claimId ? claimHref(collection.claimId) : null}
        partLabel={partLabel}
      />
    );
  }

  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    setLineError(null);
    try {
      const res = await apiFetch<Result>(`/api/pickups/${pickupId}/delivery-check`, {
        method: 'POST',
        body: { ...(body as object), collectionId: collection.collectionId },
        quiet: true,
      });
      setResult(res);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MORE_THAN_ALLOCATED') {
        const allocationId = (e.details as { allocationId?: string } | undefined)?.allocationId;
        if (allocationId) setLineError({ allocationId, message: e.message });
        else setError(e.message);
      } else if (
        e instanceof ApiError &&
        (e.code === 'CHECK_EXISTS' || e.code === 'CHECK_WINDOW_CLOSED')
      ) {
        setError(e.message);
        router.refresh();
      } else {
        setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const setIssue = (allocationId: string, change: Partial<Issue>) =>
    setIssues((prev) => ({
      ...prev,
      [allocationId]: { missing: null, damaged: null, ...prev[allocationId], ...change },
    }));
  // Only lines with something missing or damaged show a photo picker, and only those send photos.
  const shownPhotos = lines.flatMap((l) =>
    count(issues[l.allocationId!]?.missing) + count(issues[l.allocationId!]?.damaged) > 0
      ? (photos[l.allocationId!] ?? [])
      : [],
  );
  const uploading = shownPhotos.some((p) => !p.done && !p.error);
  const hasBadPhoto = shownPhotos.some((p) => p.error);

  function report() {
    const problem = lines.flatMap((l) => {
      const i = issues[l.allocationId!];
      const missing = count(i?.missing);
      const damaged = count(i?.damaged);
      return missing + damaged > 0 ? [{ line: l, missing, damaged }] : [];
    });
    if (problem.length === 0) {
      setError('Add how many are missing or damaged, or go back and tap "All received".');
      return;
    }
    if (uploading) {
      setError('Wait for the photos to finish uploading.');
      return;
    }
    if (hasBadPhoto) {
      setError('Remove the photos that did not upload, then send again.');
      return;
    }
    void send({
      lines: problem.map(({ line, missing, damaged }) => ({
        allocationId: line.allocationId,
        missing,
        damaged,
        photoIds: (photos[line.allocationId!] ?? []).flatMap((p) => (p.photoId ? [p.photoId] : [])),
      })),
    });
  }

  if (!reporting) {
    return (
      <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
        <h2 id={`${id}-title`} className="text-xl font-bold">
          {title}
        </h2>
        <p className="text-base">Open the boxes and count. Did everything arrive in good shape?</p>
        <p className="text-muted-foreground text-base">
          Check by <time dateTime={deadline.toISOString()}>{formatMyt(deadline)}</time>. After that
          these goods count as received, not checked.
        </p>
        <ul className="bg-card flex flex-col divide-y rounded-2xl border">
          {lines.map((l) => (
            <li key={l.allocationId} className="p-3">
              <LineHead line={l} />
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className={FIELD_ERROR}>
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({ allReceived: true })}
          className={cn(BUTTON_PRIMARY, 'min-h-16 w-full text-xl')}
        >
          {busy ? 'Saving…' : 'All received'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setReporting(true)}
          className={cn(BUTTON_SECONDARY, 'w-full')}
        >
          Report a problem
        </button>
      </section>
    );
  }

  return (
    <form
      noValidate
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        report();
      }}
    >
      <h2 id={`${id}-title`} className="text-xl font-bold">
        Report a problem{partLabel ? ` (${partLabel})` : ''}
      </h2>
      <p className="text-base">
        For each product, say how many did not arrive and how many came damaged. Leave the rest at
        0.
      </p>
      <ul className="flex flex-col gap-4">
        {lines.map((l) => {
          const aid = l.allocationId!;
          const i = issues[aid];
          const total = count(i?.missing) + count(i?.damaged);
          return (
            <li key={aid} className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
              <LineHead line={l} />
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-${aid}-missing`} className={FIELD_LABEL}>
                  Missing (did not arrive)
                </label>
                <QuantityStepper
                  id={`${id}-${aid}-missing`}
                  label={`Missing ${l.productName}`}
                  value={i?.missing ?? 0}
                  min={0}
                  max={l.quantity}
                  onChange={(v) => setIssue(aid, { missing: v })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-${aid}-damaged`} className={FIELD_LABEL}>
                  Damaged (arrived broken)
                </label>
                <QuantityStepper
                  id={`${id}-${aid}-damaged`}
                  label={`Damaged ${l.productName}`}
                  value={i?.damaged ?? 0}
                  min={0}
                  max={l.quantity}
                  onChange={(v) => setIssue(aid, { damaged: v })}
                />
              </div>
              {total > l.quantity ? (
                <p role="alert" className={FIELD_ERROR}>
                  Missing and damaged add up to more than the {l.quantity} expected.
                </p>
              ) : null}
              {lineError?.allocationId === aid ? (
                <p role="alert" className={FIELD_ERROR}>
                  {lineError.message}
                </p>
              ) : null}
              {total > 0 ? (
                <PhotoPicker
                  pickupId={pickupId}
                  label={`Photos of the problem (${l.productName})`}
                  photos={photos[aid] ?? []}
                  onChange={(update) =>
                    setPhotos((prev) => ({ ...prev, [aid]: update(prev[aid] ?? []) }))
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy || uploading} className={cn(BUTTON_PRIMARY, 'w-full')}>
        {busy ? 'Sending…' : 'Send report'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setReporting(false);
          setError(null);
        }}
        className={cn(BUTTON_SECONDARY, 'w-full')}
      >
        Back
      </button>
    </form>
  );
}

/**
 * One delivery check per collection (O7, P1-8): a pickup collected in two parts shows two checks,
 * each with its own goods, "All received" and "Report a problem".
 */
export function DeliveryChecks({
  pickup,
  claimBase,
}: {
  pickup: PickupView;
  claimBase: string | null;
}) {
  const many = pickup.collections.length > 1;
  return (
    <>
      {pickup.collections.map((c, i) => (
        <DeliveryCheckForm
          key={c.collectionId}
          pickup={pickup}
          collection={c}
          partLabel={many ? `Part ${i + 1}` : null}
          claimBase={claimBase}
        />
      ))}
    </>
  );
}
