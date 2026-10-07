import type { Cable } from '../../db/types';
import type { Bounds } from '../map/mapCommands';

// Desenhar so o que esta na tela: o painel pode ter milhares de pontos e o navegador nao precisa de todos de uma vez.

/** Acima disto, os elementos na tela viram bolinhas (leves) em vez de simbolos. */
export const MARKER_LIMIT = 1500;

export const pointInBox = (p: { lat: number; lng: number }, b: Bounds): boolean => p.lat >= b[0] && p.lat <= b[2] && p.lng >= b[1] && p.lng <= b[3];

export function boxOf(points: { lat: number; lng: number }[]): Bounds | null {
  if (points.length === 0) return null;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of points) {
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
    if (p.lng < w) w = p.lng;
    if (p.lng > e) e = p.lng;
  }
  return [s, w, n, e];
}

export const boxesIntersect = (a: Bounds, b: Bounds): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** Aumenta a caixa em `ratio` de cada lado (para o que esta logo fora da tela nao "pipocar" ao arrastar). */
export function padBox(b: Bounds, ratio: number): Bounds {
  const dLat = (b[2] - b[0]) * ratio;
  const dLng = (b[3] - b[1]) * ratio;
  return [b[0] - dLat, b[1] - dLng, b[2] + dLat, b[3] + dLng];
}

/** Cabos cuja caixa toca a area (um cabo comprido atravessando a tela conta, mesmo sem vertice dentro dela). */
export function cablesInBox(cables: Cable[], box: Bounds): Cable[] {
  return cables.filter((c) => {
    const b = boxOf(c.vertices);
    return b !== null && boxesIntersect(b, box);
  });
}
