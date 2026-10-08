import { Fragment, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { useDraft } from '../elements/draftStore';
import { routeStore, useSelectedRoute } from './routeStore';
import { cableStore } from './cableRepo';
import { routeOf } from './routes';
import { CASING_COLOR, CASING_EXTRA, cableStyle } from './style';

const ROUTE_COLOR = '#ffd400';
const DIM = 0.3;

/**
 * Cabos salvos: linha colorida pelas fibras, com contorno preto e uma faixa larga invisível para facilitar o toque.
 * Tocar num cabo acende a rota toda dele (os cabos ligados), com um halo amarelo; o resto do mapa esmaece.
 */
export default function CablesLayer() {
  const list = useLiveQuery(() => cableStore.list());
  const selected = useSelectedRoute();
  const idle = useDraft((s) => s.phase === 'idle');
  const route = useMemo(() => (selected && list ? routeOf(selected, list) : null), [selected, list]);
  const lit = useMemo(() => new Set(route?.cableIds ?? []), [route]);

  // o cabo tocado foi excluído (ou nunca existiu): não deixa uma rota vazia acesa
  useEffect(() => {
    if (selected && list && !list.some((c) => c.id === selected)) routeStore.clear();
  }, [selected, list]);

  if (!list) return null;
  const active = lit.size > 0;
  const junctions = route ? junctionPoints(route.junctions, list.filter((c) => lit.has(c.id))) : [];
  return (
    <>
      {list.map((c) => {
        const st = cableStyle(c.fiberCount);
        const pts = c.vertices.map((v) => [v.lat, v.lng] as [number, number]);
        const round = { lineCap: 'round', lineJoin: 'round' } as const;
        const on = lit.has(c.id);
        const dim = active && !on;
        return (
          <Fragment key={c.id}>
            {on && <Polyline positions={pts} pathOptions={{ color: ROUTE_COLOR, weight: st.weight + CASING_EXTRA + 12, opacity: 0.9, interactive: false, ...round }} />}
            {on && c.id === selected && <Polyline positions={pts} pathOptions={{ color: '#ffffff', weight: st.weight + CASING_EXTRA + 6, interactive: false, ...round }} />}
            <Polyline positions={pts} pathOptions={{ color: CASING_COLOR, weight: st.weight + CASING_EXTRA, opacity: dim ? DIM : 1, interactive: false, ...round }} />
            <Polyline positions={pts} pathOptions={{ color: st.color, weight: st.weight, opacity: dim ? DIM : 1, interactive: false, ...round }} />
            {/* Faixa de toque (~24 px). Fora do "idle" o clique segue para o mapa (marcar/mover/lançar). */}
            <Polyline
              positions={pts}
              pathOptions={{ color: '#000', weight: 24, opacity: 0, bubblingMouseEvents: false }}
              eventHandlers={{
                click() {
                  if (idle) routeStore.select(c.id);
                },
              }}
            />
          </Fragment>
        );
      })}
      {junctions.map((p) => (
        <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={11} pathOptions={{ color: ROUTE_COLOR, weight: 4, fillColor: '#000', fillOpacity: 0.85, interactive: false }} />
      ))}
    </>
  );
}

/** Onde estão os pontos de ligação da rota (a posição do elemento, tirada de um cabo que passa por ele). */
function junctionPoints(ids: readonly string[], cables: readonly { vertices: { elementId?: string; lat: number; lng: number }[] }[]) {
  const out: { id: string; lat: number; lng: number }[] = [];
  for (const id of ids) {
    for (const c of cables) {
      const v = c.vertices.find((x) => x.elementId === id);
      if (v) {
        out.push({ id, lat: v.lat, lng: v.lng });
        break;
      }
    }
  }
  return out;
}

/** Dentro do mapa: tocar no vazio apaga a rota; ao marcar algo ela some; ao acender, enquadra a rota acima da folha. */
export function RouteMapEffects() {
  const map = useMap();
  const selected = useSelectedRoute();
  const idle = useDraft((s) => s.phase === 'idle');
  const list = useLiveQuery(() => cableStore.list());
  useMapEvents({ click: () => routeStore.clear() });

  useEffect(() => {
    if (!idle) routeStore.clear();
  }, [idle]);

  useEffect(() => {
    if (!selected || !list) return;
    const ids = routeOf(selected, list).cableIds;
    const pts = list.filter((c) => ids.includes(c.id)).flatMap((c) => c.vertices);
    if (pts.length === 0) return;
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const box: [[number, number], [number, number]] = [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
    if (map.getBounds().contains(box)) return; // já aparece toda: não mexe no mapa
    map.fitBounds(box, { paddingTopLeft: [48, 110], paddingBottomRight: [48, 330], maxZoom: 19 });
    // só quando o cabo tocado muda: dados novos chegando não podem mover o mapa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, map]);
  return null;
}
