import type { Cable } from '../../db/types';

// Ligações entre cabos e a rota que elas formam. Duas ligações "neste elemento, o cabo A continua no cabo B" valem nos dois
// sentidos; guardadas num dos dois cabos (o que quem ligou pôde alterar). Tudo puro e testado.

/** Uma ligação que vale hoje: nos dois cabos passam pelo elemento, e nenhum foi excluído. */
export interface CableEdge {
  elementId: string;
  a: string;
  b: string;
}

const passes = (c: Cable, elementId: string): boolean => c.vertices.some((v) => v.elementId === elementId);

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const edgeKey = (e: CableEdge): string => `${e.elementId}|${pairKey(e.a, e.b)}`;

/**
 * As ligações que ainda valem. Uma ligação some sozinha (sem ser apagada) quando um dos cabos é excluído ou deixa de passar
 * pelo elemento, e volta se isso desfizer. Ligação repetida (guardada nos dois cabos) conta uma vez.
 */
export function activeEdges(cables: readonly Cable[]): CableEdge[] {
  const byId = new Map(cables.filter((c) => !c.deleted).map((c) => [c.id, c] as const));
  const seen = new Set<string>();
  const out: CableEdge[] = [];
  for (const c of byId.values()) {
    for (const l of c.links ?? []) {
      const other = byId.get(l.cableId);
      if (!other || other.id === c.id || !passes(c, l.elementId) || !passes(other, l.elementId)) continue;
      const edge: CableEdge = { elementId: l.elementId, a: c.id, b: other.id };
      const k = edgeKey(edge);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(edge);
    }
  }
  return out;
}

/** Cabos (não excluídos) que passam por este elemento, na ordem recebida. */
export const cablesAt = (cables: readonly Cable[], elementId: string): Cable[] => cables.filter((c) => !c.deleted && passes(c, elementId));

/** Os cabos que já estão ligados entre si neste elemento. */
export function linkedAt(cables: readonly Cable[], elementId: string): Set<string> {
  const ids = new Set<string>();
  for (const e of activeEdges(cables)) {
    if (e.elementId !== elementId) continue;
    ids.add(e.a);
    ids.add(e.b);
  }
  return ids;
}

export interface Route {
  /** O cabo de partida primeiro, depois os ligados a ele, em largura. Vazio se o cabo não existe. */
  cableIds: string[];
  /** Elementos onde há ligação dentro da rota. */
  junctions: string[];
}

/** Todos os cabos ligados (direta ou indiretamente) ao cabo `cableId`, ele incluído. */
export function routeOf(cableId: string, cables: readonly Cable[]): Route {
  const live = new Set(cables.filter((c) => !c.deleted).map((c) => c.id));
  if (!live.has(cableId)) return { cableIds: [], junctions: [] };
  const edges = activeEdges(cables);
  const seen = new Set([cableId]);
  const order = [cableId];
  const junctions = new Set<string>();
  for (let i = 0; i < order.length; i++) {
    const cur = order[i]!;
    for (const e of edges) {
      const next = e.a === cur ? e.b : e.b === cur ? e.a : null;
      if (next === null) continue;
      junctions.add(e.elementId);
      if (!seen.has(next)) {
        seen.add(next);
        order.push(next);
      }
    }
  }
  return { cableIds: order, junctions: [...junctions] };
}

export interface LinkChange {
  elementId: string;
  a: string;
  b: string;
}

export interface LinkPlan {
  add: LinkChange[];
  remove: LinkChange[];
}

/**
 * O que mudar para que os cabos `wanted` fiquem todos ligados entre si neste elemento (e só eles). Menos de 2 cabos = desfazer
 * as ligações do elemento. Só cabos que passam pelo elemento entram.
 */
export function planLinks(cables: readonly Cable[], elementId: string, wanted: ReadonlySet<string>): LinkPlan {
  const here = new Set(cablesAt(cables, elementId).map((c) => c.id));
  const members = [...wanted].filter((id) => here.has(id)).sort();
  const want = new Set<string>();
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) want.add(pairKey(members[i]!, members[j]!)); // 0 ou 1 cabo: nenhum par
  const current = new Map<string, CableEdge>();
  for (const e of activeEdges(cables)) if (e.elementId === elementId) current.set(pairKey(e.a, e.b), e);
  const add: LinkChange[] = [];
  for (const k of want) if (!current.has(k)) add.push({ elementId, a: k.split('|')[0]!, b: k.split('|')[1]! });
  const remove: LinkChange[] = [];
  for (const [k, e] of current) if (!want.has(k)) remove.push({ elementId, a: e.a, b: e.b });
  return { add, remove };
}

/** Soma do total (traçado + reservas) dos cabos de `ids`, em metros, arredondada para 2 casas. */
export function routeMeters(ids: readonly string[], cables: readonly Cable[]): number {
  const want = new Set(ids);
  const sum = cables.reduce((n, c) => (want.has(c.id) && !c.deleted ? n + c.totalMeters : n), 0);
  return Math.round(sum * 100) / 100;
}

export interface Connection {
  elementId: string;
  /** O outro cabo. */
  cableId: string;
}

/** As ligações do cabo `cableId` (uma por elemento e cabo ligado), na ordem em que aparecem. */
export function connectionsOf(cableId: string, cables: readonly Cable[]): Connection[] {
  const out: Connection[] = [];
  for (const e of activeEdges(cables)) {
    if (e.a === cableId) out.push({ elementId: e.elementId, cableId: e.b });
    else if (e.b === cableId) out.push({ elementId: e.elementId, cableId: e.a });
  }
  return out;
}
