import type { NetworkElement } from '../../db/types';
import { canEdit } from '../../lib/ownership';
import { cablesToSave, type CableDraft, type DraftCable } from './cableDraft';
import { readFeed } from './feed';

/** Uma CTO do lançamento para a qual dá para dizer de qual fibra ela vive, e o cabo que a alimenta. */
export interface CtoSpot {
  element: NetworkElement;
  cable: DraftCable;
  /** O cabo termina nela (e não só passa). */
  end: boolean;
}

/**
 * As CTOs do que está sendo salvo que ainda não têm fibra de entrada e que eu posso alterar: onde um cabo termina e onde
 * passa. O ponto onde um ramal começa pertence ao cabo de onde ele saiu (o ramal só nasce ali). Uma CTO aparece uma vez,
 * ligada ao cabo que termina nela (ou, se nenhum termina, ao primeiro que passa). Na ordem em que foram lançadas.
 */
export function ctoSpots(d: CableDraft, elements: ReadonlyMap<string, NetworkElement>): CtoSpot[] {
  const saved = cablesToSave(d);
  const savedIds = new Set(saved.map((c) => c.cableId));
  const picked = new Map<string, CtoSpot>();
  for (const cable of saved) {
    cable.vertices.forEach((v, i) => {
      if (!v.elementId || (i === 0 && cable.parentId && savedIds.has(cable.parentId))) return;
      const element = elements.get(v.elementId);
      if (!element || element.deleted || element.type !== 'cto' || !canEdit(element) || readFeed(element.attrs)) return;
      const end = i === cable.vertices.length - 1;
      const before = picked.get(element.id);
      if (!before || (end && !before.end)) picked.set(element.id, { element, cable, end });
    });
  }
  return [...picked.values()];
}
