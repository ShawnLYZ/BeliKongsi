'use client';

import { useEffect } from 'react';

/** Runs `onShow` when the page is shown again from the back-forward cache (e.g. Back after paying). */
export function usePageShow(onShow: () => void): void {
  useEffect(() => {
    const handler = (e: PageTransitionEvent) => {
      if (e.persisted) onShow();
    };
    window.addEventListener('pageshow', handler);
    return () => window.removeEventListener('pageshow', handler);
  }, [onShow]);
}
