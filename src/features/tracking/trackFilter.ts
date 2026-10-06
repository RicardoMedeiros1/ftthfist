import { distanceMeters, type LatLng } from '../../lib/geo';

// Filtros da trilha (CLAUDE.md): descartar pontos com precisão pior que 30 m e pontos a menos de 5 m do anterior.
export const MAX_ACCURACY_M = 30;
export const MIN_DISTANCE_M = 5;

export type FilterResult = 'aceito' | 'impreciso' | 'proximo';

/** `prev` é o último ponto aceito do mesmo trecho (null no primeiro ponto de um trecho). */
export function filterTrackPoint(prev: LatLng | null, p: LatLng & { accuracy: number }): FilterResult {
  // `!(x <= max)` também recusa NaN.
  if (!(p.accuracy <= MAX_ACCURACY_M)) return 'impreciso';
  if (prev && distanceMeters(prev, p) < MIN_DISTANCE_M) return 'proximo';
  return 'aceito';
}
