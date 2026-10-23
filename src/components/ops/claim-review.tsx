import type { ReactNode } from 'react';
import type { ClaimView } from '@/server/modules/checks/claims';
import { Money } from '@/components/common/money';
import { formatMyt } from '@/lib/format';
import { ClaimDecision } from './claim-decision';
import { consignmentStatusWords } from './consignment-labels';
import { TABLE, TABLE_WRAP, TD, TD_NUM, TH, TH_NUM } from './labels';

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = `card-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="bg-card flex flex-col gap-3 rounded-2xl border p-5">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const statusWords = (status: string) =>
  consignmentStatusWords(status as Parameters<typeof consignmentStatusWords>[0]) ?? status;

/**
 * Everything Ops needs to decide one claim, side by side (story 128): the photos, what the shop
 * counted, the hub's record and the consignment's history, with Approve and Reject.
 */
export function ClaimReview({ claim }: { claim: ClaimView }) {
  const decided = claim.status !== 'submitted';
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Claim review</h1>
        <p className="text-base">
          Reported by <strong>{claim.check.submittedBy ?? 'the shop'}</strong> on{' '}
          <time dateTime={claim.check.submittedAt}>
            {formatMyt(new Date(claim.check.submittedAt))}
          </time>
          . Refund asked: <Money sen={claim.totalRefundSen} className="font-semibold" />.
        </p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Card title="Photos and the refund">
            <ul className="flex flex-col gap-4">
              {claim.lines.map((l, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="text-base font-semibold">
                    {l.productName}:{' '}
                    <span className="tabular-nums">
                      {l.missing} missing, {l.damaged} damaged
                    </span>{' '}
                    · refund <Money sen={l.refundSen} />
                  </p>
                  {l.photoUrls.length === 0 ? (
                    <p className="text-muted-foreground text-base">No photos were added.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-3">
                      {l.photoUrls.map((url, j) => (
                        <li key={j}>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="focus-visible:ring-ring/60 block rounded-xl outline-none focus-visible:ring-3"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Photo ${j + 1} of ${l.productName}`}
                              className="h-40 w-40 rounded-xl border object-cover"
                            />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-base">
              Photo links work for 10 minutes. Reload the page for fresh ones.
            </p>
          </Card>

          <Card title="What the shop counted">
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <caption className="sr-only">The shop&apos;s delivery check, line by line</caption>
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className={TH}>
                      Product
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Expected
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Good
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Missing
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Damaged
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {claim.check.lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className={TD}>{l.productName}</td>
                      <td className={TD_NUM}>{l.expected}</td>
                      <td className={TD_NUM}>{l.receivedGood}</td>
                      <td className={TD_NUM}>{l.missing}</td>
                      <td className={TD_NUM}>{l.damaged}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Decision">
            {decided ? (
              <div role="status" className="text-base">
                <p className="font-semibold">
                  {claim.status === 'approved' ? (
                    <>
                      Approved. <Money sen={claim.totalRefundSen} /> was refunded to the shop.
                    </>
                  ) : (
                    'Rejected. No refund was made.'
                  )}
                </p>
                {claim.reason ? <p>Reason: {claim.reason}</p> : null}
              </div>
            ) : claim.approvalId ? (
              <ClaimDecision approvalId={claim.approvalId} />
            ) : (
              <p className="text-base">This claim has no approval request.</p>
            )}
          </Card>

          <Card title="Hub record">
            {claim.hubCheck ? (
              <dl className="text-base">
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-muted-foreground">Good units</dt>
                  <dd className="font-medium tabular-nums">{claim.hubCheck.goodUnits}</dd>
                </div>
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-muted-foreground">Damaged units</dt>
                  <dd className="font-medium tabular-nums">{claim.hubCheck.damagedUnits}</dd>
                </div>
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-muted-foreground">Checked</dt>
                  <dd className="font-medium">
                    <time dateTime={claim.hubCheck.checkedAt}>
                      {formatMyt(new Date(claim.hubCheck.checkedAt))}
                    </time>
                  </dd>
                </div>
                {claim.hubCheck.notes ? (
                  <div className="py-1">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd>{claim.hubCheck.notes}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-base">No hub check is on record for these goods.</p>
            )}
          </Card>

          <Card title="Consignment history">
            {claim.consignmentHistory.length === 0 ? (
              <p className="text-base">No consignment history.</p>
            ) : (
              <ol className="flex flex-col text-base">
                {claim.consignmentHistory.map((h, i) => (
                  <li key={i} className="flex justify-between gap-4 border-t py-2 first:border-t-0">
                    <span>{statusWords(h.status)}</span>
                    <time dateTime={h.at} className="text-muted-foreground whitespace-nowrap">
                      {formatMyt(new Date(h.at))}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
