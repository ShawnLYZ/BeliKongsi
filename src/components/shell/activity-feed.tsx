'use client';

import { useState } from 'react';
import type { LogEntryView } from '@/server/modules/activity/query';
import { apiFetch } from '@/components/common/api-client';
import { Timeline } from '@/components/common/timeline';

/** The activity timeline with "Show older entries" paging through GET /api/activity. */
export function ActivityFeed({
  initialItems,
  initialCursor,
  filterQuery = '',
}: {
  initialItems: LogEntryView[];
  initialCursor: string | null;
  /** The page's filters as a query string, repeated on every next-page request. */
  filterQuery?: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await apiFetch<{ items: LogEntryView[]; nextCursor: string | null }>(
        `/api/activity?cursor=${encodeURIComponent(cursor)}${filterQuery ? `&${filterQuery}` : ''}`,
      );
      setItems((list) => [...list, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Timeline items={items} />
      {cursor ? (
        <button
          type="button"
          disabled={loading}
          onClick={loadMore}
          className="border-input/50 bg-card hover:bg-muted focus-visible:ring-ring/60 inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-base font-semibold outline-none focus-visible:ring-3 disabled:opacity-60"
        >
          {loading ? 'Loading…' : 'Show older entries'}
        </button>
      ) : null}
    </div>
  );
}
