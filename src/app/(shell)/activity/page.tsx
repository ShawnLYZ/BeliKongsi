import type { Role } from '@/generated/prisma/client';
import { EmptyState } from '@/components/common/empty-state';
import { ActivityFeed } from '@/components/shell/activity-feed';
import { VerifyLogButton } from '@/components/shell/verify-log-button';
import { ACTIONS } from '@/server/modules/activity/actions';
import { actionLabel } from '@/components/common/timeline';
import { logFiltersFromParams, logPeople, queryLog } from '@/server/modules/activity/query';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { AppError } from '@/server/platform/errors';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

// What each role sees (PRD §14 visibility); staff see only their own actions.
const INTRO: Record<Role, string> = {
  owner: 'Everything done for your shop, newest first.',
  staff: 'Your own actions, newest first.',
  supplier: 'Everything about your orders, newest first.',
  ops: 'Every entry in the hash-chained activity log, newest first.',
};

const FIELD =
  'border-input/50 bg-card focus-visible:ring-ring/60 min-h-11 rounded-xl border px-3 text-base outline-none focus-visible:ring-3';

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = requirePageRole(await getPageSession(), ['owner', 'staff', 'supplier', 'ops']);
  const { role } = session.membership;
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['from', 'to', 'actorUserId', 'action', 'subjectType', 'subjectId']) {
    const value = raw[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }
  const filters = logFiltersFromParams(query);
  const filtered = query.size > 0;
  const deps = getDeps();
  const caller = personCaller(session);
  const people = role === 'ops' ? await logPeople(deps, caller) : [];
  let page: Awaited<ReturnType<typeof queryLog>> = { items: [], nextCursor: null };
  let problem: string | null = null;
  try {
    page = await queryLog(deps, caller, {
      ...filters,
      cursor: null,
      limit: 20,
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 400) throw error;
    problem = error.message;
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold">
          {role === 'staff' ? 'My actions' : 'Activity log'}
        </h1>
        <p className="mt-1 text-base">{INTRO[role]}</p>
      </div>
      {role === 'ops' ? <VerifyLogButton /> : null}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-base font-semibold">
          From
          <input type="date" name="from" defaultValue={filters.from ?? ''} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-base font-semibold">
          To
          <input type="date" name="to" defaultValue={filters.to ?? ''} className={FIELD} />
        </label>
        {role === 'ops' ? (
          <label className="flex flex-col gap-1 text-base font-semibold">
            Who did it
            <select name="actorUserId" defaultValue={filters.actorUserId ?? ''} className={FIELD}>
              <option value="">Anyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {filters.subjectType ? (
          <input type="hidden" name="subjectType" value={filters.subjectType} />
        ) : null}
        {filters.subjectId ? (
          <input type="hidden" name="subjectId" value={filters.subjectId} />
        ) : null}
        <label className="flex flex-col gap-1 text-base font-semibold">
          What happened
          <select name="action" defaultValue={filters.action ?? ''} className={FIELD}>
            <option value="">Anything</option>
            {ACTIONS.map((code) => (
              <option key={code} value={code}>
                {actionLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="bg-primary text-primary-foreground focus-visible:ring-ring/60 inline-flex min-h-11 items-center rounded-xl px-4 text-base font-semibold outline-none focus-visible:ring-3"
        >
          Filter
        </button>
        {filtered ? (
          <a href="/activity" className="inline-flex min-h-11 items-center text-base underline">
            Clear filters
          </a>
        ) : null}
        {role === 'ops' ? (
          <a
            href={`/api/activity/export${filtered ? `?${query}` : ''}`}
            className="inline-flex min-h-11 items-center text-base font-semibold underline"
          >
            Download as CSV
          </a>
        ) : null}
      </form>
      {filters.subjectType || filters.subjectId ? (
        <p className="text-base">
          Only entries about {[filters.subjectType, filters.subjectId].filter(Boolean).join(' ')}.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-base font-semibold">
          {problem}
        </p>
      ) : null}
      {page.items.length === 0 ? (
        <EmptyState
          title={filtered ? 'Nothing matches these filters' : 'Nothing here yet'}
          explanation="Each sign-in, approval, payment and delivery check appears here with who did it and when."
          example="Signed in · Mon 3 Nov, 9:15 am."
        />
      ) : (
        <ActivityFeed
          key={`${query}|${page.items[0]?.seq}`}
          initialItems={page.items}
          initialCursor={page.nextCursor}
          filterQuery={query.toString()}
        />
      )}
    </div>
  );
}
