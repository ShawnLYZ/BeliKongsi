import { EmptyState } from '@/components/common/empty-state';
import { EventsTable } from '@/components/ops/events-table';
import { listEvents } from '@/server/modules/integration/events';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OpsEventsPage() {
  const session = requirePageRole(await getPageSession(), ['ops']);
  const deps = getDeps();
  scheduleDueWork(deps);
  const events = await listEvents(deps, personCaller(session));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Integration events</h1>
        <p className="text-base font-semibold">Latest 100, newest first</p>
        <p className="max-w-3xl text-base">
          Every change other Orbyte apps may care about is written here in the same step as the
          change itself. Events hold ids, quantities, amounts and statuses only, never names or
          contact details.
        </p>
        <p className="text-muted-foreground max-w-3xl text-base">
          How other Orbyte apps will subscribe (coming later): an app registers a webhook URL, and
          each new event is sent to it with a signature header, retried until it is received. Until
          then, the events are listed here.
        </p>
      </div>
      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          explanation="When rounds close, refunds are issued or lines are dropped, each event appears here with its data."
          example='round.closed · Thu 12 Nov, 8:01 pm · { "outcome": "formed", "finalTier": 3 }'
        />
      ) : (
        <EventsTable events={events} />
      )}
    </div>
  );
}
