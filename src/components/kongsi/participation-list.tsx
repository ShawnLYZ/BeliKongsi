'use client';

import { useState } from 'react';
import type { ParticipationView } from '@/lib/views/participations';
import { apiFetch } from '@/components/common/api-client';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { ParticipationCard } from './participation-card';

/** My Kongsi's cards, with "Show older orders" paging through the participations API. */
export function ParticipationList({
  shopId,
  status,
  initialItems,
  initialCursor,
  serverNow,
}: {
  shopId: string;
  status: 'active' | 'history';
  initialItems: ParticipationView[];
  initialCursor: string | null;
  serverNow: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await apiFetch<{ items: ParticipationView[]; nextCursor: string | null }>(
        `/api/shops/${shopId}/participations?status=${status}&cursor=${encodeURIComponent(cursor)}`,
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
      <ul className="flex flex-col gap-3">
        {items.map((p) => (
          <li key={p.participationId}>
            <ParticipationCard p={p} serverNow={serverNow} />
          </li>
        ))}
      </ul>
      {cursor ? (
        <button type="button" disabled={loading} onClick={loadMore} className={BUTTON_SECONDARY}>
          {loading ? 'Loading…' : 'Show older orders'}
        </button>
      ) : null}
    </div>
  );
}
