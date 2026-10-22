'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ConsignmentView } from '@/lib/views/fulfilment';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { formatMytDate } from '@/lib/format';
import { CONSIGNMENT_STATUSES, STATUS_COLOURS, consignmentStatusWords } from './consignment-labels';
import { TABLE, TABLE_WRAP, TD, TD_NUM, TH, TH_NUM } from './labels';
import type { NetworkPlace, NetworkRoute } from './network-map';

// Lazy and browser-only: the Maps script loads only when this view is on screen (PRD §18).
const NetworkMap = dynamic(() => import('./network-map'), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true" className="bg-muted h-[28rem] animate-pulse rounded-2xl" />
  ),
});

export interface NetworkPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

const placeKey = (name: string, lat: number, lng: number) => `${name}|${lat}|${lng}`;

/** Hubs, every pickup point and door destinations, each coloured by its newest consignment. */
function networkOf(consignments: ConsignmentView[], points: NetworkPoint[]) {
  const places = new Map<string, NetworkPlace>();
  for (const p of points) {
    places.set(placeKey(p.name, p.lat, p.lng), {
      id: `point-${p.id}`,
      name: p.name,
      kind: 'pickup_point',
      at: { lat: p.lat, lng: p.lng },
      status: null,
    });
  }
  // Consignments come newest delivery date first, so the first one to a place colours it.
  for (const c of consignments) {
    const hubKey = placeKey(c.hubName, c.hubLatLng.lat, c.hubLatLng.lng);
    if (!places.has(hubKey)) {
      places.set(hubKey, {
        id: `hub-${hubKey}`,
        name: c.hubName,
        kind: 'hub',
        at: c.hubLatLng,
        status: null,
      });
    }
    const key = placeKey(c.destinationName, c.destinationLatLng.lat, c.destinationLatLng.lng);
    const place = places.get(key);
    if (!place) {
      places.set(key, {
        id: `dest-${c.consignmentId}`,
        name: c.destinationName,
        kind: c.destinationType,
        at: c.destinationLatLng,
        status: c.status,
      });
    } else if (place.status === null) {
      place.status = c.status;
    }
  }
  const routes: NetworkRoute[] = consignments.map((c) => ({
    id: c.consignmentId,
    from: c.hubLatLng,
    to: c.destinationLatLng,
    status: c.status,
  }));
  return { places: [...places.values()], routes };
}

function Legend() {
  return (
    <ul aria-label="Line and pin colours" className="flex flex-wrap gap-x-4 gap-y-2 text-base">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-4 rounded-full bg-[#1c1917]" />
        Hub
      </li>
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="size-4 rounded-full border-2 border-[#1c1917] bg-white"
        />
        Pickup point, nothing on the way
      </li>
      {CONSIGNMENT_STATUSES.map((s) => (
        <li key={s} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-1.5 w-6 rounded-full"
            style={{ backgroundColor: STATUS_COLOURS[s] }}
          />
          {consignmentStatusWords(s)}
        </li>
      ))}
    </ul>
  );
}

function RouteList({ consignments }: { consignments: ConsignmentView[] }) {
  if (consignments.length === 0) {
    return <p className="text-muted-foreground text-base">No consignments yet.</p>;
  }
  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <caption className="sr-only">Consignments from hub to destination</caption>
        <thead className="border-b">
          <tr>
            <th scope="col" className={TH}>
              From hub
            </th>
            <th scope="col" className={TH}>
              To
            </th>
            <th scope="col" className={TH}>
              Delivery date
            </th>
            <th scope="col" className={TH_NUM}>
              Units
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {consignments.map((c) => (
            <tr key={c.consignmentId}>
              <td className={TD}>{c.hubName}</td>
              <td className={TD}>
                {c.destinationName}
                <span className="text-muted-foreground block">
                  {c.destinationType === 'door' ? 'Door delivery' : 'Pickup point'}
                </span>
              </td>
              <td className={TD}>
                <time dateTime={c.deliveryDate}>{formatMytDate(c.deliveryDate)}</time>
              </td>
              <td className={TD_NUM}>{c.itemCount}</td>
              <td className={TD}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLOURS[c.status] }}
                  />
                  {consignmentStatusWords(c.status)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The network as a map (hubs, pickup points, lines from hub to destination coloured by status),
 * with a list view that is also the fallback when the map cannot load (no key, or a load error).
 */
export function NetworkView({
  consignments,
  points,
}: {
  consignments: ConsignmentView[];
  points: NetworkPoint[];
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const [asList, setAsList] = useState(false);
  const onMapFail = useCallback(() => setMapFailed(true), []);
  const { places, routes } = useMemo(() => networkOf(consignments, points), [consignments, points]);
  const showList = asList || mapFailed;

  return (
    <section aria-labelledby="network-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="network-title" className="text-xl font-bold">
          Network
        </h2>
        {!mapFailed ? (
          <button type="button" onClick={() => setAsList((v) => !v)} className={BUTTON_SECONDARY}>
            {asList ? 'Show as a map' : 'Show as a list'}
          </button>
        ) : null}
      </div>
      {mapFailed ? (
        <p role="status" className="bg-muted rounded-xl p-3 text-base">
          The map is not available, so the network is shown as a list.
        </p>
      ) : null}
      {showList ? (
        <RouteList consignments={consignments} />
      ) : (
        <>
          <NetworkMap places={places} routes={routes} onFail={onMapFail} />
          <Legend />
        </>
      )}
    </section>
  );
}
