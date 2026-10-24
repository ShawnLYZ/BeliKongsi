'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ConsignmentView } from '@/lib/views/fulfilment';
import { apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY } from '@/components/common/controls';
import { NewDateForm } from './new-date-form';
import { type PartnerStatus, nextConsignmentStep } from '@/lib/consignment-steps';
import { formatMyt, formatMytDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  CONSIGNMENT_STATUSES,
  STATUS_COLOURS,
  consignmentMovedMessage,
  consignmentStatusWords,
  stepActionLabel,
} from './consignment-labels';

function lastMove(c: ConsignmentView): string | null {
  const last = c.statusHistory.at(-1);
  return last ? formatMyt(new Date(last.at)) : null;
}

/**
 * Every consignment in a column for its status (story 125). Each card offers only the allowed
 * next partner step (the same table the server checks), through POST /api/consignments/{id}/status.
 */
export function ConsignmentBoard({ consignments }: { consignments: ConsignmentView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function move(c: ConsignmentView, status: PartnerStatus) {
    setBusy(c.consignmentId);
    try {
      const moved = await apiFetch<ConsignmentView>(`/api/consignments/${c.consignmentId}/status`, {
        method: 'POST',
        body: { status },
      });
      toast.success(consignmentMovedMessage(c, status, moved.status));
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
      {CONSIGNMENT_STATUSES.map((status) => {
        const items = consignments.filter((c) => c.status === status);
        return (
          <section
            key={status}
            aria-labelledby={`cons-col-${status}`}
            className="bg-muted/60 flex flex-col gap-2 rounded-2xl p-3"
          >
            <h2
              id={`cons-col-${status}`}
              className="flex items-center justify-between gap-2 text-lg font-semibold"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ backgroundColor: STATUS_COLOURS[status] }}
                />
                {consignmentStatusWords(status)}
              </span>
              <span className="tabular-nums">{items.length}</span>
            </h2>
            {items.length === 0 ? (
              <p className="text-muted-foreground text-base">No consignments</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((c) => {
                  const next = nextConsignmentStep(c.destinationType, c.status);
                  const moved = lastMove(c);
                  return (
                    <li
                      key={c.consignmentId}
                      className="bg-card flex flex-col gap-1 rounded-xl border p-3 text-base"
                    >
                      <p className="font-semibold">
                        {c.hubName} → {c.destinationName}
                      </p>
                      <p className="text-muted-foreground">
                        {c.destinationType === 'door' ? 'Door delivery' : 'Pickup point'} ·{' '}
                        <time dateTime={c.deliveryDate}>{formatMytDate(c.deliveryDate)}</time>
                        {c.wave > 1 ? ` · wave ${c.wave}` : ''}
                      </p>
                      <p className="tabular-nums">
                        {c.itemCount} {c.itemCount === 1 ? 'unit' : 'units'} · {c.partnerReference}
                      </p>
                      {c.containsFeaturedRound ? (
                        <p>
                          <span className="bg-accent text-accent-foreground rounded-md px-2 py-0.5 font-semibold">
                            Featured round
                          </span>
                        </p>
                      ) : null}
                      {moved ? <p className="text-muted-foreground">Last move {moved}</p> : null}
                      {next ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void move(c, next)}
                          className={cn(BUTTON_PRIMARY, 'mt-1 w-full')}
                        >
                          {busy === c.consignmentId ? 'Saving…' : stepActionLabel(next)}
                        </button>
                      ) : null}
                      {c.status !== 'delivered' && c.status !== 'completed' ? (
                        <NewDateForm
                          endpoint={`/api/consignments/${c.consignmentId}/delay`}
                          className="mt-1"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
