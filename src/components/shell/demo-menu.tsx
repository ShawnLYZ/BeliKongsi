'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/components/common/api-client';

/**
 * Demo controls, shown only in demo mode. M2 has "Reset demo data"; M5 adds "Skip to cut-off"
 * and M7 "Complete other rounds".
 */
export function DemoMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [resetting, setResetting] = useState(false);

  const close = () => dialog.current?.close();

  async function reset() {
    setResetting(true);
    try {
      await apiFetch('/api/demo/reset', { method: 'POST' });
      toast.success('Demo data reset. Everything is back to Monday morning.');
      close();
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setResetting(false);
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
          if (e.target === dialog.current && !resetting) close();
        }}
        onCancel={(e) => {
          if (resetting) e.preventDefault();
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
            disabled={resetting}
            aria-label="Close"
            className="hover:bg-muted focus-visible:ring-ring/60 inline-flex size-11 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none disabled:opacity-60"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-base">
            Puts every made-up business, order and balance back to the start of the demo week
            (Monday 6:05 am). Your changes are wiped. It takes a few seconds.
          </p>
          <button
            type="button"
            onClick={reset}
            disabled={resetting}
            className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring/60 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold focus-visible:ring-3 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
          >
            <RotateCcw aria-hidden className={resetting ? 'size-5 animate-spin' : 'size-5'} />
            {resetting ? 'Resetting…' : 'Reset demo data'}
          </button>
        </div>
      </dialog>
    </>
  );
}
