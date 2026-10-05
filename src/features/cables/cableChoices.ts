import type { Cable } from '../../db/types';
import { formatMeters, type LatLng } from '../../lib/geo';
import { nearestCableVertex } from './nearestVertex';

export interface CableChoice {
  id: string;
  label: string;
  distance: number;
}

export const cableLabel = (c: Pick<Cable, 'cableType' | 'fiberCount' | 'totalMeters'>) =>
  `${c.cableType} · ${c.fiberCount} fibras · ${formatMeters(c.totalMeters)}`;

/** Distância (m) dentro da qual uma reserva é sugerida para um cabo: ela fica "sobre um vértice" dele. */
export const RESERVE_LINK_METERS = 15;

/** Cabos com algum vértice perto da posição, do mais próximo ao mais distante. `include` mantém o cabo atual mesmo se longe. */
export function cableChoicesNear(
  pos: LatLng,
  cables: Cable[],
  maxMeters = RESERVE_LINK_METERS,
  include?: string,
): CableChoice[] {
  const out: CableChoice[] = [];
  for (const c of cables) {
    if (c.deleted) continue;
    const near = nearestCableVertex(pos, [c], maxMeters);
    if (near) out.push({ id: c.id, label: cableLabel(c), distance: near.distance });
    else if (c.id === include) out.push({ id: c.id, label: cableLabel(c), distance: Infinity });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
