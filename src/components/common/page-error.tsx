'use client';

import Link from 'next/link';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from './controls';

/**
 * A page that failed to load (an `error.tsx` boundary): says what happened and what to do next.
 * `retry` fetches and renders the page again.
 */
export function PageError({ retry }: { retry: () => void }) {
  return (
    <section
      role="alert"
      className="bg-card text-card-foreground flex max-w-xl flex-col gap-4 rounded-2xl border p-5"
    >
      <h1 className="text-2xl font-bold">This page could not load</h1>
      <p className="text-base">
        Something went wrong on our side while loading it. Try again, or go back to your home
        screen.
      </p>
      <button
        type="button"
        onClick={retry}
        className={`${BUTTON_PRIMARY} w-full sm:w-auto sm:self-start`}
      >
        Try again
      </button>
      <Link href="/" className={`${BUTTON_SECONDARY} w-full sm:w-auto sm:self-start`}>
        Back to home
      </Link>
    </section>
  );
}
