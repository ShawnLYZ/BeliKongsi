'use client';

import { useEffect } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useApiLoadingStatus,
} from '@vis.gl/react-google-maps';

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

// G5: the only key that reaches the browser. Maps JavaScript API only: no Geocoding, Places or Routes.
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
// Google's demo map id: lets Advanced Markers render without a project-specific style.
const MAP_ID = 'DEMO_MAP_ID';

function boundsOf(points: readonly MapPoint[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
    padding: 40,
  };
}

/** Reports a failed or refused script load, so the page falls back to the list alone. */
function FailureWatcher({ onFail }: { onFail: () => void }) {
  const status = useApiLoadingStatus();
  useEffect(() => {
    if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) onFail();
  }, [status, onFail]);
  return null;
}

/**
 * Pickup points on a Google map; tapping a pin chooses that point. Load it with `next/dynamic`
 * (`ssr: false`). The list next to it is the accessible way to choose, and still works if the map
 * does not load.
 */
export default function PickupMap({
  points,
  selectedId,
  onSelect,
  onFail,
}: {
  points: readonly MapPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFail: () => void;
}) {
  useEffect(() => {
    if (!API_KEY || points.length === 0) onFail();
  }, [points.length, onFail]);
  if (!API_KEY || points.length === 0) return null;

  return (
    <APIProvider apiKey={API_KEY} onError={onFail} language="en" region="MY">
      <FailureWatcher onFail={onFail} />
      <div
        role="region"
        aria-label="Map of pickup points. You can also choose from the list below."
        className="h-64 w-full overflow-hidden rounded-2xl border"
      >
        <GoogleMap
          mapId={MAP_ID}
          defaultBounds={boundsOf(points)}
          gestureHandling="cooperative"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
        >
          {points.map((p) => {
            const selected = p.id === selectedId;
            return (
              <AdvancedMarker
                key={p.id}
                position={{ lat: p.lat, lng: p.lng }}
                title={p.name}
                zIndex={selected ? 10 : 1}
                onClick={() => onSelect(p.id)}
              >
                <Pin
                  background={selected ? '#0f766e' : '#f5a623'}
                  borderColor={selected ? '#0b5f59' : '#1c1917'}
                  glyphColor={selected ? '#ffffff' : '#1c1917'}
                  scale={selected ? 1.3 : 1}
                />
              </AdvancedMarker>
            );
          })}
        </GoogleMap>
      </div>
    </APIProvider>
  );
}
