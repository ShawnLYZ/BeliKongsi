'use client';

import { useEffect } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  Polyline,
  useApiLoadingStatus,
} from '@vis.gl/react-google-maps';
import type { ConsignmentStatusView, LatLng } from '@/lib/views/fulfilment';
import { STATUS_COLOURS } from './consignment-labels';

// G5: the only key that reaches the browser. Maps JavaScript API only, as in pickup-map.tsx.
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
// Google's demo map id: lets Advanced Markers render without a project-specific style.
const MAP_ID = 'DEMO_MAP_ID';

export interface NetworkPlace {
  id: string;
  name: string;
  kind: 'hub' | 'pickup_point' | 'door';
  at: LatLng;
  /** The status of the newest consignment to this place, which colours its pin. */
  status: ConsignmentStatusView | null;
}

export interface NetworkRoute {
  id: string;
  from: LatLng;
  to: LatLng;
  status: ConsignmentStatusView;
}

function boundsOf(places: readonly NetworkPlace[]) {
  const lats = places.map((p) => p.at.lat);
  const lngs = places.map((p) => p.at.lng);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
    padding: 48,
  };
}

/** Reports a failed or refused script load, so the page falls back to the list. */
function FailureWatcher({ onFail }: { onFail: () => void }) {
  const status = useApiLoadingStatus();
  useEffect(() => {
    if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) onFail();
  }, [status, onFail]);
  return null;
}

function PlacePin({ place }: { place: NetworkPlace }) {
  if (place.kind === 'hub') {
    return <Pin background="#1c1917" borderColor="#000000" glyphColor="#ffffff" scale={1.3} />;
  }
  const colour = place.status ? STATUS_COLOURS[place.status] : '#ffffff';
  return (
    <Pin
      background={colour}
      borderColor="#1c1917"
      glyphColor={place.status ? '#ffffff' : '#1c1917'}
      scale={place.status ? 1.1 : 0.9}
    />
  );
}

/**
 * The logistics network on a Google map (story 126): hubs, pickup points and door destinations,
 * with a line from hub to destination per consignment, coloured by its status. Load it with
 * `next/dynamic` (`ssr: false`); the list beside it is the fallback when the map cannot load.
 */
export default function NetworkMap({
  places,
  routes,
  onFail,
}: {
  places: readonly NetworkPlace[];
  routes: readonly NetworkRoute[];
  onFail: () => void;
}) {
  useEffect(() => {
    if (!API_KEY || places.length === 0) onFail();
  }, [places.length, onFail]);
  if (!API_KEY || places.length === 0) return null;

  return (
    <APIProvider apiKey={API_KEY} onError={onFail} language="en" region="MY">
      <FailureWatcher onFail={onFail} />
      <div
        role="region"
        aria-label="Map of hubs, pickup points and consignments. The same network is in the list view."
        className="h-[28rem] w-full overflow-hidden rounded-2xl border"
      >
        <GoogleMap
          mapId={MAP_ID}
          defaultBounds={boundsOf(places)}
          gestureHandling="cooperative"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
        >
          {routes.map((r) => (
            <Polyline
              key={r.id}
              path={[r.from, r.to]}
              strokeColor={STATUS_COLOURS[r.status]}
              strokeOpacity={0.9}
              strokeWeight={4}
            />
          ))}
          {places.map((p) => (
            <AdvancedMarker
              key={p.id}
              position={p.at}
              title={p.name}
              zIndex={p.kind === 'hub' ? 10 : 1}
            >
              <PlacePin place={p} />
            </AdvancedMarker>
          ))}
        </GoogleMap>
      </div>
    </APIProvider>
  );
}
