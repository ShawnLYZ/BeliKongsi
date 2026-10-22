'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/components/common/api-client';

type VerifyResult =
  { valid: true; count: number } | { valid: false; firstBrokenSeq: string | number };

export function verifyResultText(result: VerifyResult): string {
  return result.valid
    ? `Valid (${result.count} ${result.count === 1 ? 'entry' : 'entries'})`
    : `Broken at entry ${result.firstBrokenSeq}`;
}

/** Ops only: recomputes every hash in the activity log (PRD §14). */
export function VerifyLogButton() {
  const router = useRouter();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      setResult(await apiFetch<VerifyResult>('/api/activity/verify', { method: 'POST' }));
      router.refresh(); // the check adds its own "Activity log verified" entry
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={verify}
        disabled={busy}
        className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring/60 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold outline-none focus-visible:ring-3 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        <ShieldCheck aria-hidden className="size-5" />
        {busy ? 'Verifying…' : 'Verify log'}
      </button>
      <p role="status" className="text-base font-semibold tabular-nums">
        {result ? (
          <span className={result.valid ? 'text-primary' : 'text-destructive'}>
            <span aria-hidden>{result.valid ? '✅' : '❌'}</span> {verifyResultText(result)}
          </span>
        ) : null}
      </p>
    </div>
  );
}
