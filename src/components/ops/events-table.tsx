import type { EventView } from '@/server/modules/integration/events';
import { formatMyt } from '@/lib/format';

/** The integration events outbox as a table: type, time in Malaysia and the data as JSON. */
export function EventsTable({ events }: { events: EventView[] }) {
  return (
    <div className="bg-card overflow-x-auto rounded-2xl border">
      <table className="w-full border-collapse text-left text-base">
        <caption className="sr-only">Latest 100 integration events, newest first</caption>
        <thead className="bg-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">
              Type
            </th>
            <th scope="col" className="px-4 py-3 font-semibold whitespace-nowrap">
              Time (MYT)
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Data
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t align-top">
              <td className="px-4 py-3">
                <code className="font-mono font-semibold">{e.type}</code>
                <span className="text-muted-foreground block tabular-nums">
                  #{e.seq} · v{e.version}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                <time dateTime={e.occurredAt}>{formatMyt(new Date(e.occurredAt))}</time>
              </td>
              <td className="px-4 py-3">
                <pre className="bg-muted max-w-[48rem] overflow-x-auto rounded-lg p-3 font-mono text-base leading-relaxed">
                  {JSON.stringify(e.data, null, 2)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
