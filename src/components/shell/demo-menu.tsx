'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FastForward, FlaskConical, RotateCcw, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { formatMyt } from '@/lib/format';

const ACTION =
  'focus-visible:ring-ring/60 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold focus-visible:ring-3 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60';
const PRIMARY = `${ACTION} bg-primary text-primary-foreground hover:bg-primary-hover`;
const SECONDARY = `${ACTION} border-input/50 bg-card hover:bg-muted border-2`;

/**
 * Demo controls, shown only in demo mode. M2 has "Reset demo data"; M5 adds "Skip to cut-off" and
 * M7 "Complete other rounds" (each after a confirmation).
 */
export function DemoMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<'reset' | 'skip' | 'complete' | null>(null);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const working = busy !== null;

  const close = () => dialog.current?.close();

  async function skipToCutoff() {
    setBusy('skip');
    setSkipError(null);
    try {
      const r = await apiFetch<{ now: string; closed: number }>('/api/demo/skip-to-cutoff', {
        method: 'POST',
        quiet: true,
      });
      toast.success(
        `Skipped to ${formatMyt(new Date(r.now))}. ${r.closed} ${r.closed === 1 ? 'round' : 'rounds'} closed.`,
      );
      close();
      router.refresh();
    } catch (error) {
      setSkipError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
      setConfirmingSkip(false);
    } finally {
      setBusy(null);
    }
  }

  async function completeOtherRounds() {
    setBusy('complete');
    setCompleteError(null);
    try {
      const r = await apiFetch<{ rounds: number; consignmentsMoved: number }>(
        '/api/demo/complete-other-rounds',
        { method: 'POST', quiet: true },
      );
      toast.success(
        `${r.rounds} other ${r.rounds === 1 ? 'round' : 'rounds'} completed. ${r.consignmentsMoved} ${r.consignmentsMoved === 1 ? 'consignment' : 'consignments'} moved on.`,
      );
      close();
      router.refresh();
    } catch (error) {
      setCompleteError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
      setConfirmingComplete(false);
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy('reset');
    try {
      await apiFetch('/api/demo/reset', { method: 'POST' });
      toast.success('Demo data reset. Everything is back to Monday morning.');
      close();
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-base font-medium hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white focus-visible:outline-none"
      >
        <FlaskConical aria-hidden className="size-5" />
        <span>Demo</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="demo-menu-title"
        onClick={(e) => {
          if (e.target === dialog.current && !working) close();
        }}
        onClose={() => {
          setConfirmingSkip(false);
          setSkipError(null);
          setConfirmingComplete(false);
          setCompleteError(null);
        }}
        onCancel={(e) => {
          if (working) e.preventDefault();
        }}
        className="bg-popover text-popover-foreground mx-auto mt-4 w-[calc(100%-2rem)] max-w-md rounded-2xl p-0 shadow-xl backdrop:bg-black/50 sm:mt-16"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <h2 id="demo-menu-title" className="text-lg font-semibold">
            Demo controls
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={working}
            aria-label="Close"
            className="hover:bg-muted focus-visible:ring-ring/60 inline-flex size-11 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none disabled:opacity-60"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="flex flex-col gap-5 p-4">
          <section aria-labelledby="demo-skip-title" className="flex flex-col gap-3">
            <h3 id="demo-skip-title" className="text-base font-semibold">
              Skip to cut-off
            </h3>
            {confirmingSkip ? (
              <>
                <p className="text-base" id="demo-skip-confirm">
                  Move demo time to one minute after the next cut-off? Every round due by then
                  closes now: shops are refunded the difference or dropped, and the results are
                  sent. Only &ldquo;Reset demo data&rdquo; undoes it.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={skipToCutoff}
                    disabled={working}
                    aria-describedby="demo-skip-confirm"
                    className={PRIMARY}
                  >
                    <FastForward aria-hidden className="size-5" />
                    {busy === 'skip' ? 'Closing rounds…' : 'Yes, skip to cut-off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingSkip(false)}
                    disabled={working}
                    className={SECONDARY}
                  >
                    Go back
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-base">
                  Jumps demo time to just after the next round cut-off and closes the rounds that
                  are due, so you can see the results and refunds straight away.
                </p>
                {skipError ? (
                  <p role="alert" className="text-destructive text-base font-medium">
                    {skipError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSkipError(null);
                    setConfirmingSkip(true);
                  }}
                  disabled={working}
                  className={SECONDARY}
                >
                  <FastForward aria-hidden className="size-5" />
                  Skip to cut-off
                </button>
              </>
            )}
          </section>
          <section
            aria-labelledby="demo-complete-title"
            className="flex flex-col gap-3 border-t pt-4"
          >
            <h3 id="demo-complete-title" className="text-base font-semibold">
              Complete other rounds
            </h3>
            {confirmingComplete ? (
              <>
                <p className="text-base" id="demo-complete-confirm">
                  Play the suppliers, the hub and the logistics partner for every round except the
                  one you are following? Their orders are confirmed, dispatched and hub-checked, and
                  their consignments move on. Only &ldquo;Reset demo data&rdquo; undoes it.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={completeOtherRounds}
                    disabled={working}
                    aria-describedby="demo-complete-confirm"
                    className={PRIMARY}
                  >
                    <Truck aria-hidden className="size-5" />
                    {busy === 'complete' ? 'Completing rounds…' : 'Yes, complete other rounds'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingComplete(false)}
                    disabled={working}
                    className={SECONDARY}
                  >
                    Go back
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-base">
                  Moves every other closed round through ordering, dispatch and the hub check, so
                  the goods of the whole week reach the pickup points together.
                </p>
                {completeError ? (
                  <p role="alert" className="text-destructive text-base font-medium">
                    {completeError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setCompleteError(null);
                    setConfirmingComplete(true);
                  }}
                  disabled={working}
                  className={SECONDARY}
                >
                  <Truck aria-hidden className="size-5" />
                  Complete other rounds
                </button>
              </>
            )}
          </section>
          <section aria-labelledby="demo-reset-title" className="flex flex-col gap-3 border-t pt-4">
            <h3 id="demo-reset-title" className="text-base font-semibold">
              Reset demo data
            </h3>
            <p className="text-base">
              Puts every made-up business, order and balance back to the start of the demo week
              (Monday 6:05 am). Your changes are wiped. It takes a few seconds.
            </p>
            <button type="button" onClick={reset} disabled={working} className={PRIMARY}>
              <RotateCcw
                aria-hidden
                className={busy === 'reset' ? 'size-5 animate-spin' : 'size-5'}
              />
              {busy === 'reset' ? 'Resetting…' : 'Reset demo data'}
            </button>
          </section>
        </div>
      </dialog>
    </>
  );
}
