import type { Cable, NetworkElement } from '../../db/types';
import type { LatLng } from '../../lib/geo';
import { cableLabel } from './cableChoices';
import { DEFAULT_COLOR_STANDARD, fiberInfo, fiberLabel, type FiberInfo } from './fibers';
import { isUuid } from './linkData';
import { nearestCableVertex } from './nearestVertex';

// A fibra que alimenta uma CTO: o técnico diz de qual cabo e qual fibra ela pegou. Fica nos atributos da CTO
// (`feedCableId` e `feedFiber`). Puro e testado.

export interface Feed {
  cableId: string;
  /** Número da fibra no cabo, a partir de 1. */
  fiber: number;
}

/** A fibra de entrada guardada nos atributos da CTO; null se não tem (ou está pela metade). */
export function readFeed(attrs: unknown): Feed | null {
  const a = (attrs && typeof attrs === 'object' ? attrs : {}) as Record<string, unknown>;
  const fiber = a.feedFiber;
  if (!isUuid(a.feedCableId) || typeof fiber !== 'number' || !Number.isInteger(fiber) || fiber < 1) return null;
  return { cableId: a.feedCableId, fiber };
}

/** Distância (m) dentro da qual um cabo aparece como opção para a CTO, mesmo sem passar por ela. */
export const FEED_NEAR_METERS = 30;

export interface FeedChoice {
  cable: Cable;
  label: string;
  /** O cabo passa pela CTO (é ela um dos pontos do traçado). */
  through: boolean;
  distance: number;
}

/**
 * Cabos que podem alimentar a CTO: primeiro os que passam por ela, depois os que têm um ponto a até FEED_NEAR_METERS
 * (o cabo pode ter sido lançado até o poste ao lado). `include` mantém o cabo já escolhido mesmo se estiver longe.
 */
export function feedChoices(pos: LatLng, cables: readonly Cable[], elementId?: string, include?: string): FeedChoice[] {
  const out: FeedChoice[] = [];
  for (const c of cables) {
    if (c.deleted) continue;
    const through = elementId !== undefined && c.vertices.some((v) => v.elementId === elementId);
    const near = nearestCableVertex(pos, [c], FEED_NEAR_METERS);
    if (through) out.push({ cable: c, label: cableLabel(c), through: true, distance: near?.distance ?? 0 });
    else if (near) out.push({ cable: c, label: cableLabel(c), through: false, distance: near.distance });
    else if (c.id === include) out.push({ cable: c, label: cableLabel(c), through: false, distance: Infinity });
  }
  return out.sort((a, b) => Number(b.through) - Number(a.through) || a.distance - b.distance);
}

/** Texto de uma CTO para dizer "a fibra 7 já é da CTO-3". */
export const ctoName = (e: Pick<NetworkElement, 'code'>): string => (e.code ? `CTO ${e.code}` : 'CTO sem código');

/** Fibras do cabo que já alimentam alguma CTO (fibra → nome(s) da CTO). `except` deixa de fora a CTO que está sendo editada. */
export function usedFibers(elements: readonly NetworkElement[], cableId: string, except?: string): Map<number, string> {
  const names = new Map<number, string[]>();
  for (const e of elements) {
    if (e.deleted || e.type !== 'cto' || e.id === except) continue;
    const f = readFeed(e.attrs);
    if (!f || f.cableId !== cableId) continue;
    names.set(f.fiber, [...(names.get(f.fiber) ?? []), ctoName(e)]);
  }
  return new Map([...names].map(([fiber, list]) => [fiber, list.join(', ')]));
}

export interface FeedView {
  /** Cabo encontrado? */
  cable: Cable | null;
  /** Cor e tubo da fibra (null se o cabo não existe ou não tem essa fibra). */
  fiber: FiberInfo | null;
  /** "Fibra 7 · Marrom · Tubo 2 Amarelo" ou o motivo de não dar para dizer. */
  text: string;
}

/** A fibra de entrada pronta para mostrar, com a cor no padrão do cabo. */
export function describeFeed(feed: Feed, cables: readonly Cable[]): FeedView {
  const cable = cables.find((c) => c.id === feed.cableId && !c.deleted) ?? null;
  if (!cable) return { cable: null, fiber: null, text: `Fibra ${feed.fiber} (cabo não encontrado)` };
  const info = fiberInfo(cable.fiberCount, feed.fiber, cable.colorStandard ?? DEFAULT_COLOR_STANDARD);
  if (!info) return { cable, fiber: null, text: `Fibra ${feed.fiber} (este cabo só tem ${cable.fiberCount} fibras)` };
  return { cable, fiber: info, text: fiberLabel(info) };
}
