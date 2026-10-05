import type { Cable } from '../../db/types';
import { distanceMeters, type LatLng } from '../../lib/geo';

export interface NearVertex {
  cable: Cable;
  index: number;
  distance: number;
}

/** O vértice de cabo mais próximo da posição, dentro de `maxMeters` (para sugerir a que cabo uma reserva pertence). */
export function nearestCableVertex(pos: LatLng, cables: Cable[], maxMeters: number): NearVertex | null {
  let best: NearVertex | null = null;
  for (const cable of cables) {
    if (cable.deleted) continue;
    cable.vertices.forEach((v, index) => {
      const distance = distanceMeters(pos, v);
      if (distance <= maxMeters && (!best || distance < best.distance)) best = { cable, index, distance };
    });
  }
  return best;
}
