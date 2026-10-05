import { length } from '@turf/length';
import { lineString } from '@turf/helpers';

// Utilidades geográficas e regras de precisão do GPS.

/** Acima disso o app avisa e oferece ajustar o ponto arrastando (CLAUDE.md, princípio 3). */
export const ACCURACY_WARN_M = 15;

export type AccuracyLevel = 'boa' | 'ruim';

export function classifyAccuracy(accuracyMeters: number): AccuracyLevel {
  return accuracyMeters > ACCURACY_WARN_M ? 'ruim' : 'boa';
}

export function formatAccuracy(accuracyMeters: number): string {
  return `±${Math.round(accuracyMeters)} m`;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Comprimento do traçado em metros (soma dos trechos, na horizontal).
 * O Turf usa uma esfera: difere do elipsoide WGS-84 (régua do Google Earth) em até ~0,6%.
 * Não inclui a flecha do cabo entre postes; para isso existem as reservas.
 */
export function pathLengthMeters(points: LatLng[]): number {
  if (points.length < 2) return 0;
  return length(lineString(points.map((p) => [p.lng, p.lat])), { units: 'meters' });
}

export const distanceMeters = (a: LatLng, b: LatLng) => pathLengthMeters([a, b]);

/** Arredonda para centímetros (evita ruído de ponto flutuante nos totais gravados). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Metros no formato brasileiro: 128,4 m. */
export function formatMeters(m: number): string {
  return `${m.toFixed(1).replace('.', ',')} m`;
}

/** O item mais próximo de `target` (em pixels) dentro do raio, ou null. Usado para "grudar" o toque num elemento. */
export function nearestWithin<T extends { x: number; y: number }>(
  target: { x: number; y: number },
  items: T[],
  radius: number,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const it of items) {
    const d = Math.hypot(it.x - target.x, it.y - target.y);
    if (d <= radius && d < bestD) {
      best = it;
      bestD = d;
    }
  }
  return best;
}
