'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import type { NotificationView } from '@/server/modules/notifications/query';
import { apiFetch } from '@/components/common/api-client';
import { formatMyt } from '@/lib/format';
import { whatsappShareUrl } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';

const ACTION =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:opacity-60';

/** The in-app notification list, each with its WhatsApp preview text and a share link (PRD §13). */
export function NotificationList({
  initialItems,
  initialCursor,
}: {
  initialItems: NotificationView[];
  initialCursor: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [busy, setBusy] = useState<string | null>(null);
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set());

  async function markRead(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      setReadHere((ids) => new Set(ids).add(id));
      router.refresh(); // updates the bell count
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(null);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setBusy('more');
    try {
      const page = await apiFetch<{ items: NotificationView[]; nextCursor: string | null }>(
        `/api/notifications?cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((list) => [...list, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((n) => {
          const unread = n.readAt === null && !readHere.has(n.id);
          return (
            <li
              key={n.id}
              className={cn(
                'bg-card rounded-2xl border p-4',
                unread && 'border-l-primary border-l-4',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="text-base font-semibold">
                  {unread ? <span className="sr-only">Unread: </span> : null}
                  {n.title}
                </h2>
                <time dateTime={n.createdAt} className="text-muted-foreground text-base">
                  {formatMyt(new Date(n.createdAt))}
                </time>
              </div>
              <p className="mt-1 text-base tabular-nums">{n.body}</p>
              <figure className="bg-muted mt-3 rounded-xl p-3">
                <figcaption className="text-muted-foreground text-base font-semibold">
                  WhatsApp preview
                </figcaption>
                <p className="mt-1 text-base whitespace-pre-line tabular-nums">{n.whatsappText}</p>
              </figure>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={whatsappShareUrl(n.whatsappText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    ACTION,
                    'bg-primary text-primary-foreground hover:bg-primary-hover',
                  )}
                >
                  <MessageCircle aria-hidden className="size-5" />
                  Share via WhatsApp
                </a>
                {unread ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => markRead(n.id)}
                    className={cn(ACTION, 'border-input/50 bg-card hover:bg-muted border')}
                  >
                    Mark as read
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {cursor ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={loadMore}
          className={cn(ACTION, 'border-input/50 bg-card hover:bg-muted border')}
        >
          {busy === 'more' ? 'Loading…' : 'Show older notifications'}
        </button>
      ) : null}
    </div>
  );
}
