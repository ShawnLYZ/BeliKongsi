import type { ApprovalView } from '@/server/modules/approvals/approvals';
import { formatMyt } from '@/lib/format';

/** "Overdue" beside an approval that has waited 12 hours or more for Ops (P1-11, story 134). */
export function OverdueBadge({ item }: { item: Pick<ApprovalView, 'overdueAt'> }) {
  if (!item.overdueAt) return null;
  return (
    <p className="mt-1">
      <span className="bg-destructive/15 text-destructive inline-flex rounded-md px-2 py-0.5 text-base font-semibold">
        Overdue
        <span className="sr-only"> since {formatMyt(new Date(item.overdueAt))}</span>
      </span>
    </p>
  );
}
