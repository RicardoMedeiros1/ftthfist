import { Polyline } from 'react-leaflet';
import { groupSegments, thinForDisplay } from '../tracking/trackStats';
import { useRemoteTrack } from './adminRuntime';

/**
 * Trilha de outra pessoa (so o administrador, so quando pediu): fina e TRACEJADA, em azul com contorno branco.
 * Nunca se parece com cabo (grosso, colorido e continuo) nem com a trilha propria (preta).
 */
export default function RemoteTrackLayer() {
  const t = useRemoteTrack();
  if (t.status !== 'pronta' || t.points.length < 2) return null;
  return (
    <>
      {groupSegments(t.points).map((seg, i) => {
        const pts = thinForDisplay(seg).map((p) => [p.lat, p.lng] as [number, number]);
        if (pts.length < 2) return null;
        return (
          <span key={i}>
            <Polyline positions={pts} pathOptions={{ color: '#ffffff', weight: 4, opacity: 0.9, interactive: false, lineCap: 'round' }} />
            <Polyline positions={pts} pathOptions={{ color: '#0a58ff', weight: 2, dashArray: '2 7', interactive: false, lineCap: 'round' }} />
          </span>
        );
      })}
    </>
  );
}
