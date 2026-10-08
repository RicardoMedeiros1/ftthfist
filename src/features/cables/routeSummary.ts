import type { Cable, NetworkElement } from '../../db/types';
import { describeFeed, readFeed, usedFibers, type FeedView } from './feed';
import { routeMeters, routeOf, type Route } from './routes';

// O que a rota de um cabo tem: os cabos ligados, os metros, as CTOs e a fibra que cada uma pegou. Puro e testado; usado pela
// folha do mapa do técnico e pela ficha do painel.

export interface RouteCto {
  element: NetworkElement;
  /** A fibra de entrada, se foi informada. */
  feed: FeedView | null;
}

export interface RouteSummary {
  route: Route;
  /** Os cabos da rota, o de partida primeiro. */
  cables: Cable[];
  meters: number;
  /** CTOs ligadas a algum cabo da rota (ponto do traçado ou fibra de entrada), em ordem de código. */
  ctos: RouteCto[];
  /** Quantas fibras de cada cabo da rota já alimentam alguma CTO. */
  fibersInUse: Map<string, number>;
}

const byCode = (a: NetworkElement, b: NetworkElement): number => {
  if (!a.code !== !b.code) return a.code ? -1 : 1; // sem código por último
  return a.code.localeCompare(b.code, 'pt-BR', { numeric: true });
};

export function summarizeRoute(cableId: string, cables: readonly Cable[], elements: readonly NetworkElement[]): RouteSummary {
  const route = routeOf(cableId, cables);
  const ids = new Set(route.cableIds);
  const byId = new Map(cables.map((c) => [c.id, c] as const));
  const inRoute = route.cableIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const onRoute = new Set(inRoute.flatMap((c) => c.vertices.flatMap((v) => (v.elementId ? [v.elementId] : []))));

  const ctos: RouteCto[] = [];
  for (const e of [...elements].sort(byCode)) {
    if (e.deleted || e.type !== 'cto') continue;
    const feed = readFeed(e.attrs);
    if (!onRoute.has(e.id) && !(feed && ids.has(feed.cableId))) continue;
    ctos.push({ element: e, feed: feed ? describeFeed(feed, cables) : null });
  }
  const fibersInUse = new Map(route.cableIds.map((id) => [id, usedFibers(elements, id).size] as const));
  return { route, cables: inRoute, meters: routeMeters(route.cableIds, cables), ctos, fibersInUse };
}
