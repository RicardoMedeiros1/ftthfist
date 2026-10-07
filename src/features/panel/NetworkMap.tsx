import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Cable, NetworkElement } from '../../db/types';
import { CASING_COLOR, CASING_EXTRA, cableStyle } from '../cables/style';
import { elementIcon } from '../elements/leafletIcon';
import { ELEMENT_META } from '../elements/meta';
import { BASE_LAYERS } from '../map/layers';
import type { Bounds } from '../map/mapCommands';
import type { MapData, MapView } from './mapFilters';
import { panelMapStore, usePanelMap, type Selection } from './panelMapStore';
import { MARKER_LIMIT, boxOf, cablesInBox, padBox, pointInBox } from './viewport';

/** Teto de pontos desenhados como bolinhas (acima de MARKER_LIMIT); mais que isto a tela so atrapalha. */
const DOT_LIMIT = 8000;
const BRASIL: [number, number] = [-14.2, -51.9];
const SELECT_COLOR = '#ffd400';

/** Acompanha a area visivel (para desenhar so o que esta nela) e guarda a vista para quando se volta ao painel. */
function Viewport({ onBox }: { onBox: (b: Bounds) => void }) {
  const map = useMap();
  const read = useCallback(() => {
    const b = map.getBounds();
    onBox([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    const c = map.getCenter();
    panelMapStore.setView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  }, [map, onBox]);
  useMapEvents({ moveend: read, zoomend: read, resize: read });
  useEffect(read, [read]);
  return null;
}

/** A coluna de filtros e a ficha mudam a largura do mapa: o Leaflet precisa ser avisado. */
function Resizer() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  // Sair do painel no meio de uma animacao de zoom: o fim da animacao chegaria a um mapa ja removido (erro do Leaflet).
  // O cleanup de layout roda antes do que remove o mapa.
  useLayoutEffect(() => () => void map.stop(), [map]);
  return null;
}

function fit(map: ReturnType<typeof useMap>, b: Bounds) {
  const [s, w, n, e] = b;
  if (n - s < 1e-5 && e - w < 1e-5) map.setView([(s + n) / 2, (w + e) / 2], 18, { animate: false });
  else map.fitBounds([[s, w], [n, e]], { padding: [40, 40], maxZoom: 19, animate: false });
}

/** Enquadra o que esta filtrado: ao abrir (sem vista guardada) e a cada mudanca de filtro, nunca quando so chegam dados novos. */
function FitToView({ view, fitKey }: { view: MapView; fitKey: string }) {
  const map = useMap();
  const done = useRef<string | null>(panelMapStore.getState().view ? fitKey : null);
  useEffect(() => {
    if (done.current === fitKey) return;
    const b = boxOf([...view.elements, ...view.cables.flatMap((c) => c.vertices)]);
    if (!b) return; // ainda sem nada para enquadrar: espera
    done.current = fitKey;
    fit(map, b);
  }, [view, fitKey, map]);
  return null;
}

/** "Mostrar no mapa" e resultados da busca: vai ate o item. */
function Focus({ data }: { data: MapData }) {
  const map = useMap();
  const focus = usePanelMap((s) => s.focus);
  const last = useRef(panelMapStore.getState().focus?.seq ?? 0);
  useEffect(() => {
    if (!focus || focus.seq === last.current) return;
    last.current = focus.seq;
    let b: Bounds | null = null;
    if (focus.kind === 'elemento') b = boxOf(data.elements.filter((e) => e.id === focus.id));
    else if (focus.kind === 'cabo') b = boxOf(data.cables.filter((c) => c.id === focus.id).flatMap((c) => c.vertices));
    else b = boxOf([...data.elements.filter((e) => e.activityId === focus.id), ...data.cables.filter((c) => c.activityId === focus.id).flatMap((c) => c.vertices)]);
    if (b) fit(map, b);
  }, [focus, data, map]);
  return null;
}

const Layers = memo(function Layers({ elements, cables, dense, selected, onSelect }: { elements: NetworkElement[]; cables: Cable[]; dense: boolean; selected: Selection | null; onSelect: (s: Selection) => void }) {
  const round = { lineCap: 'round', lineJoin: 'round' } as const;
  const selEl = selected?.kind === 'elemento' ? elements.find((e) => e.id === selected.id) : undefined;
  return (
    <>
      {cables.map((c) => {
        const st = cableStyle(c.fiberCount);
        const pts = c.vertices.map((v) => [v.lat, v.lng] as [number, number]);
        const sel = selected?.kind === 'cabo' && selected.id === c.id;
        return (
          <Fragment key={c.id}>
            {sel && <Polyline positions={pts} pathOptions={{ color: SELECT_COLOR, weight: st.weight + CASING_EXTRA + 8, interactive: false, ...round }} />}
            <Polyline positions={pts} pathOptions={{ color: CASING_COLOR, weight: st.weight + CASING_EXTRA, interactive: false, ...round }} />
            <Polyline positions={pts} pathOptions={{ color: st.color, weight: st.weight, interactive: false, ...round }} />
            <Polyline positions={pts} pathOptions={{ color: '#000', weight: 18, opacity: 0 }} eventHandlers={{ click: () => onSelect({ kind: 'cabo', id: c.id }) }} />
          </Fragment>
        );
      })}
      {selEl && <CircleMarker center={[selEl.lat, selEl.lng]} radius={dense ? 12 : 26} pathOptions={{ color: SELECT_COLOR, weight: 4, fill: false, interactive: false }} />}
      {elements.map((e) =>
        dense ? (
          <CircleMarker
            key={e.id}
            center={[e.lat, e.lng]}
            radius={6}
            pathOptions={{ color: '#000', weight: 1.5, fillColor: ELEMENT_META[e.type].color, fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelect({ kind: 'elemento', id: e.id }) }}
          />
        ) : (
          <Marker key={e.id} position={[e.lat, e.lng]} icon={elementIcon(e.type, 'dim')} eventHandlers={{ click: () => onSelect({ kind: 'elemento', id: e.id }) }} />
        ),
      )}
    </>
  );
});

/** O mapa da rede: todos os tecnicos, so leitura. Desenha apenas o que esta na tela (e um pouco ao redor). */
export default function NetworkMap({ data, view, fitKey, onSelect }: { data: MapData; view: MapView; fitKey: string; onSelect: (s: Selection) => void }) {
  const base = usePanelMap((s) => s.base);
  const selection = usePanelMap((s) => s.selection);
  const [box, setBox] = useState<Bounds | null>(null);
  const saved = useRef(panelMapStore.getState().view);
  const layer = BASE_LAYERS[base];
  const other = base === 'ruas' ? BASE_LAYERS.satelite : BASE_LAYERS.ruas;

  const { elements, cables, dense, hidden } = useMemo(() => {
    const padded = box ? padBox(box, 0.25) : null;
    const inside = padded ? view.elements.filter((e) => pointInBox(e, padded)) : view.elements.slice(0, MARKER_LIMIT);
    const dense = inside.length > MARKER_LIMIT;
    const shown = dense ? inside.slice(0, DOT_LIMIT) : inside;
    return { elements: shown, cables: padded ? cablesInBox(view.cables, padded) : view.cables, dense, hidden: inside.length - shown.length };
  }, [box, view]);

  return (
    <div className="panel-map-wrap">
      <MapContainer
        center={saved.current ? [saved.current.lat, saved.current.lng] : BRASIL}
        zoom={saved.current?.zoom ?? 4}
        preferCanvas
        className="panel-map"
      >
        <TileLayer key={layer.id} url={layer.url} attribution={layer.attribution} maxZoom={layer.maxZoom} crossOrigin="anonymous" />
        <Viewport onBox={setBox} />
        <Resizer />
        <FitToView view={view} fitKey={fitKey} />
        <Focus data={data} />
        <Layers elements={elements} cables={cables} dense={dense} selected={selection} onSelect={onSelect} />
      </MapContainer>
      <button className="btn btn-small panel-map-base" onClick={() => panelMapStore.setBase(other.id)} aria-label={`Trocar para ${other.label}`}>
        {other.label}
      </button>
      {dense && (
        <div className="panel-map-note" role="status">
          Muitos pontos nesta área: mostrando como bolinhas{hidden > 0 ? ` (${hidden} fora do limite)` : ''}. Aproxime para ver os símbolos.
        </div>
      )}
    </div>
  );
}
