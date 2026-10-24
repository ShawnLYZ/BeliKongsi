import type { WebhookActivity } from '@/server/modules/integration/webhooks';
import { formatMyt } from '@/lib/format';
import { TABLE, TABLE_WRAP, TD, TD_NUM, TH, TH_NUM } from './labels';

type Delivery = WebhookActivity['deliveries'][number];

const STATUS_LABELS: Record<Delivery['status'], string> = {
  pending: 'Waiting to retry',
  succeeded: 'Delivered',
  failed: 'Gave up',
};

/** A pending delivery not yet tried is queued; after a failed attempt it waits to retry. */
export function deliveryStatusLabel(d: Pick<Delivery, 'status' | 'attempt'>): string {
  return d.status === 'pending' && d.attempt === 0 ? 'Queued' : STATUS_LABELS[d.status];
}

const time = (iso: string) => <time dateTime={iso}>{formatMyt(new Date(iso))}</time>;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-lg font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Webhook subscriptions, the latest delivery attempts and what the demo receiver got. */
export function WebhooksPanel({ activity }: { activity: WebhookActivity }) {
  const { subscriptions, deliveries, receipts } = activity;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold">Webhooks</h2>
        <p className="max-w-3xl text-base">
          Other Orbyte apps register a webhook URL through the integration API. Each new event of
          the types they chose is sent to it, signed, and retried after 1 minute, 5 minutes, 30
          minutes, 2 hours and 12 hours before BeliKongsi gives up. Private and loopback addresses
          are refused. Secrets are shown to the app once and never here.
        </p>
      </div>

      <Section id="webhook-subscriptions" title="Subscriptions">
        {subscriptions.length === 0 ? (
          <p className="text-muted-foreground text-base">
            No app has registered a webhook yet. Register the demo receiver to see deliveries
            arrive.
          </p>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>
                    App
                  </th>
                  <th scope="col" className={TH}>
                    URL
                  </th>
                  <th scope="col" className={TH}>
                    Events
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH}>
                    Added (MYT)
                  </th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className={TD}>
                      <code className="font-mono">{s.appId}</code>
                    </td>
                    <td className={`${TD} break-all`}>
                      <code className="font-mono">{s.url}</code>
                      {s.isDemoReceiver ? (
                        <span className="text-muted-foreground block">Demo receiver</span>
                      ) : null}
                    </td>
                    <td className={TD}>
                      <code className="font-mono">{s.eventTypes.join(', ')}</code>
                    </td>
                    <td className={TD}>{s.active ? 'Active' : 'Removed'}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{time(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="webhook-deliveries" title="Latest delivery attempts">
        {deliveries.length === 0 ? (
          <p className="text-muted-foreground text-base">No deliveries yet.</p>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>
                    Event
                  </th>
                  <th scope="col" className={TH}>
                    App
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Attempts
                  </th>
                  <th scope="col" className={TH}>
                    Last result
                  </th>
                  <th scope="col" className={TH}>
                    Next try (MYT)
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className={TD}>
                      <code className="font-mono font-semibold">{d.eventType}</code>
                      <span className="text-muted-foreground block tabular-nums">
                        #{d.eventSeq}
                      </span>
                    </td>
                    <td className={TD}>
                      <code className="font-mono">{d.appId}</code>
                    </td>
                    <td className={TD}>{deliveryStatusLabel(d)}</td>
                    <td className={TD_NUM}>{d.attempt} of 6</td>
                    <td className={TD}>
                      {d.lastStatusCode !== null ? (
                        <span className="tabular-nums">HTTP {d.lastStatusCode}</span>
                      ) : null}
                      {d.lastError ? <span className="block">{d.lastError}</span> : null}
                      {d.lastStatusCode === null && !d.lastError ? '—' : null}
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {d.status === 'pending' ? time(d.nextAttemptAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="webhook-receipts" title="Demo receiver">
        {receipts.length === 0 ? (
          <p className="text-muted-foreground text-base">
            Nothing received yet. Register{' '}
            <code className="font-mono">/api/demo/webhook-receiver</code> on this app&apos;s own
            address, then close a round.
          </p>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className={TH}>
                    Event
                  </th>
                  <th scope="col" className={TH}>
                    Received (MYT)
                  </th>
                  <th scope="col" className={TH}>
                    Signature
                  </th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className={TD}>
                      <code className="font-mono font-semibold">{r.eventType}</code>
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{time(r.receivedAt)}</td>
                    <td className={TD}>{r.signatureValid ? 'Valid' : 'Did not match'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
