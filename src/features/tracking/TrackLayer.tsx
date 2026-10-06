import { useLiveQuery } from 'dexie-react-hooks';
import { Polyline } from 'react-leaflet';
import { activities } from '../activities/activityRepo';
import { trackStore } from './trackRepo';
import { groupSegments, thinForDisplay } from './trackStats';

/**
 * Trilha da atividade aberta: linha FINA e TRACEJADA (preta com contorno branco), para nunca ser confundida
 * com cabo (grossa, colorida e contínua). Cada trecho é uma linha própria: pausas não se ligam.
 */
export default function TrackLayer() {
  const points = useLiveQuery(async () => {
    const open = await activities.getOpen();
    return open ? trackStore.listFor(open.id) : [];
  });
  if (!points || points.length < 2) return null;
  return (
    <>
      {groupSegments(points).map((seg, i) => {
        const pts = thinForDisplay(seg).map((p) => [p.lat, p.lng] as [number, number]);
        if (pts.length < 2) return null;
        return (
          <span key={i}>
            <Polyline positions={pts} pathOptions={{ color: '#ffffff', weight: 4, opacity: 0.9, interactive: false, lineCap: 'round' }} />
            <Polyline positions={pts} pathOptions={{ color: '#111111', weight: 2, dashArray: '6 6', interactive: false }} />
          </span>
        );
      })}
    </>
  );
}
