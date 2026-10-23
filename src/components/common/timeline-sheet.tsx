'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import type { LogEntryView } from '@/server/modules/activity/query';
import { apiFetch } from '@/components/common/api-client';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { OwnerTimeline } from '@/components/common/owner-timeline';

type Loaded = { items: LogEntryView[]; verified: boolean | null };

/**
 * A "Timeline" button that opens the steps logged for one item (its pickup, check and claim too),
 * oldest first, with whether the log is still intact (PRD §14).
 */
export function TimelineSheet({
  subjectType,
  subjectId,
  title = 'Timeline',
  className = BUTTON_SECONDARY,
}: {
  subjectType: 'weekly_basket' | 'participation' | 'pickup' | 'claim';
  subjectId: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    setFailed(false);
    try {
      const query = new URLSearchParams({ subjectType, subjectId, related: '1', limit: '100' });
      const [page, check] = await Promise.all([
        apiFetch<{ items: LogEntryView[] }>(`/api/activity?${query}`, { quiet: true }),
        // The log check is best-effort: without it the timeline still shows.
        apiFetch<{ valid: boolean }>('/api/activity/verify', { quiet: true }).catch(() => null),
      ]);
      setLoaded({ items: [...page.items].reverse(), verified: check ? check.valid : null });
    } catch {
      setFailed(true);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  return (
    <>
      <button type="button" className={className} onClick={() => onOpenChange(true)}>
        <History aria-hidden className="size-5" />
        Timeline
      </button>
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description="Every step that was recorded, oldest first."
      >
        {failed ? (
          <div role="alert" className="flex flex-col gap-3">
            <p className="text-base">
              Could not load the timeline. Check your connection and try again.
            </p>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : !loaded ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <div className="bg-muted h-20 animate-pulse rounded-xl" />
            <div className="bg-muted h-20 animate-pulse rounded-xl" />
          </div>
        ) : (
          <>
            {loaded.verified === null ? null : (
              <p role="status" className="text-base font-semibold">
                Log check:{' '}
                <span className={loaded.verified ? 'text-primary' : 'text-destructive'}>
                  {loaded.verified ? 'Valid, nothing has been changed' : 'Broken, tell BeliKongsi'}
                </span>
              </p>
            )}
            {loaded.items.length === 0 ? (
              <p className="text-base">
                Nothing has been recorded for this yet. Each step appears here with its time, for
                example &ldquo;Paid, Mon 6 Oct, 9:12 am&rdquo;.
              </p>
            ) : (
              <OwnerTimeline items={loaded.items} />
            )}
          </>
        )}
      </BottomSheet>
    </>
  );
}
