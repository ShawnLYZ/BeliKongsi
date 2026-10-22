import type { LogEntryView } from '@/server/modules/activity/query';
import { formatMyt } from '@/lib/format';
import { roleLabel } from '@/lib/roles';

const ACTION_LABELS: Record<string, string> = {
  'shell.signed_in': 'Signed in',
  'shell.role_switched': 'Switched business or role',
  'demo.reset': 'Demo data reset',
  'log.verified': 'Activity log verified',
};

/** "basket.line_added_by_staff" -> "Basket: line added by staff" for codes without a label yet. */
export function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const [area, ...rest] = action.split('.');
  const words = (s: string) => s.replace(/_/g, ' ');
  if (!area) return action;
  const head = words(area).replace(/^./, (c) => c.toUpperCase());
  return rest.length ? `${head}: ${words(rest.join(' '))}` : head;
}

function actorLabel(item: LogEntryView): string {
  const who =
    item.actorName ??
    (item.actorType === 'system' ? 'BeliKongsi' : item.actorType === 'ai' ? 'AI' : 'Someone');
  return item.actorRole ? `${who} (${roleLabel(item.actorRole)})` : who;
}

function hasDetails(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** The activity log as a vertical timeline, newest first. */
export function Timeline({ items }: { items: LogEntryView[] }) {
  return (
    <ol className="border-border relative flex flex-col gap-3 border-l-2 pl-5">
      {items.map((item) => {
        const details = hasDetails(item.before) || hasDetails(item.after);
        return (
          <li key={item.seq} className="bg-card relative rounded-xl border p-4">
            <span
              aria-hidden
              className="border-card bg-primary absolute top-5 -left-[1.95rem] size-3 rounded-full border-2"
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-base font-semibold">{actionLabel(item.action)}</p>
              <p className="text-muted-foreground text-sm tabular-nums">
                <time dateTime={item.occurredAt}>{formatMyt(new Date(item.occurredAt))}</time>
                <span className="sr-only">, </span>
                <span className="ml-2">#{item.seq}</span>
              </p>
            </div>
            <p className="mt-1 text-base">{actorLabel(item)}</p>
            <p className="text-muted-foreground text-sm break-all">
              {item.subjectType.replace(/_/g, ' ')} · {item.subjectId}
            </p>
            {item.reason ? <p className="mt-1 text-base">Reason: {item.reason}</p> : null}
            {details ? (
              <details className="mt-2">
                <summary className="text-primary focus-visible:ring-ring/50 flex min-h-11 cursor-pointer items-center rounded-md text-base font-medium focus-visible:ring-3 focus-visible:outline-none">
                  Details
                </summary>
                <pre className="bg-muted mt-1 overflow-x-auto rounded-md p-3 text-sm whitespace-pre-wrap">
                  {JSON.stringify({ before: item.before, after: item.after }, null, 2)}
                </pre>
              </details>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
