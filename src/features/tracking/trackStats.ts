import { pathLengthMeters } from '../../lib/geo';

export interface TrackLike {
  lat: number;
  lng: number;
  timestamp: number;
  segment?: number;
}

/** Pontos separados por trecho (do mais antigo ao mais novo), cada trecho em ordem de horário. */
export function groupSegments<T extends TrackLike>(points: T[]): T[][] {
  const bySeg = new Map<number, T[]>();
  for (const p of points) {
    const k = p.segment ?? 0;
    const list = bySeg.get(k);
    if (list) list.push(p);
    else bySeg.set(k, [p]);
  }
  return [...bySeg.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list.sort((a, b) => a.timestamp - b.timestamp));
}

/** Soma dos trechos. Entre um trecho e outro (pausa, tela apagada) não se mede nada. */
export function trackDistanceMeters(points: TrackLike[]): number {
  return groupSegments(points).reduce((sum, seg) => sum + pathLengthMeters(seg), 0);
}

/** Para o desenho no mapa: com milhares de pontos, mostra um a cada k (sempre incluindo o último). */
export function thinForDisplay<T>(seg: T[], maxPoints = 1500): T[] {
  if (seg.length <= maxPoints) return seg;
  const k = Math.ceil(seg.length / maxPoints);
  const out = seg.filter((_, i) => i % k === 0);
  if (out[out.length - 1] !== seg[seg.length - 1]) out.push(seg[seg.length - 1]!);
  return out;
}
