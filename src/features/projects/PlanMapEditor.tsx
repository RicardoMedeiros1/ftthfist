import { DomEvent, type LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Fragment, useEffect, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { PlanPointType, ProjectPlan } from '../../db/types';
import { BASE_LAYERS, type BaseLayerId } from '../map/layers';
import type { Bounds } from '../map/mapCommands';
import { midpoints, type Selection } from './planEditor';
import { PLAN_CASING, PLAN_COLOR, PLAN_SELECT, handleIcon, midIcon, planPointIcon } from './planStyle';

export type Mode = 'selecionar' | 'traco' | 'ponto';

export type InitialView = { kind: 'bounds'; bounds: Bounds } | { kind: 'center'; lat: number; lng: number; zoom: number };

export interface PlanMapProps {
  plan: ProjectPlan;
  mode: Mode;
  selection: Selection | null;
  /** Traçado que esta sendo desenhado agora (os pontos dele aparecem como bolinhas). */
  drawingId: string | null;
  baseLayer: BaseLayerId;
  initial: InitialView;
  /** Pedido de "ir para este lugar"; `seq` muda a cada pedido. */
  jumpTo: { lat: number; lng: number; seq: number } | null;
  onMapClick(lat: number, lng: number): void;
  onSelect(sel: Selection | null): void;
  onMovePoint(id: string, lat: number, lng: number): void;
  onMoveVertex(lineId: string, index: number, lat: number, lng: number): void;
  onInsertVertex(lineId: string, index: number, lat: number, lng: number): void;
}

function Clicks({ onClick }: { onClick(lat: number, lng: number): void }) {
  useMapEvents({ click: (e: LeafletMouseEvent) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Jump({ to }: { to: PlanMapProps['jumpTo'] }) {
  const map = useMap();
  const done = useRef(0);
  useEffect(() => {
    if (!to || to.seq <= done.current) return;
    done.current = to.seq;
    map.setView([to.lat, to.lng], Math.max(map.getZoom(), 18), { animate: false });
  }, [to, map]);
  return null;
}

function ZoomButtons() {
  const map = useMap();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // tocar nos botoes nao pode virar clique no mapa (que poria um ponto no desenho)
    DomEvent.disableClickPropagation(ref.current);
    DomEvent.disableScrollPropagation(ref.current);
  }, []);
  return (
    <div ref={ref} className="map-btn-group" role="group" aria-label="Zoom">
      <button className="map-btn" aria-label="Aproximar" onClick={() => map.zoomIn()}>+</button>
      <button className="map-btn" aria-label="Afastar" onClick={() => map.zoomOut()}>−</button>
    </div>
  );
}

const TYPE_OF = (p: { type: PlanPointType }) => p.type;

/** O mapa onde o administrador desenha. So desenha e avisa o que foi tocado/arrastado: quem decide o que mudar e a tela. */
export default function PlanMapEditor(props: PlanMapProps) {
  const { plan, mode, selection, drawingId, baseLayer, initial, jumpTo } = props;
  const layer = BASE_LAYERS[baseLayer];
  const picking = mode === 'selecionar'; // nos outros modos todo toque e para desenhar (nada atrapalha o clique)
  const selLine = selection?.kind === 'line' ? selection.id : selection?.kind === 'vertex' ? selection.lineId : null;

  return (
    <MapContainer
      className="plan-map"
      zoomControl={false}
      {...(initial.kind === 'bounds' ? { bounds: [[initial.bounds[0], initial.bounds[1]], [initial.bounds[2], initial.bounds[3]]] as [[number, number], [number, number]], boundsOptions: { padding: [40, 40] as [number, number], maxZoom: 19 } } : { center: [initial.lat, initial.lng] as [number, number], zoom: initial.zoom })}
    >
      <TileLayer key={layer.id} url={layer.url} attribution={layer.attribution} maxZoom={layer.maxZoom} crossOrigin="anonymous" />
      <Clicks onClick={props.onMapClick} />
      <Jump to={jumpTo} />
      <ZoomButtons />

      {plan.lines.map((l) => {
        const pts = l.points;
        const sel = l.id === selLine && selection?.kind === 'line';
        return (
          <Fragment key={l.id}>
            {sel && <Polyline positions={pts} pathOptions={{ color: PLAN_SELECT, weight: 12, opacity: 0.9, interactive: false, lineCap: 'round', lineJoin: 'round' }} />}
            <Polyline positions={pts} pathOptions={{ color: PLAN_CASING, weight: 8, opacity: 0.7, interactive: false, lineCap: 'round', lineJoin: 'round' }} />
            <Polyline positions={pts} pathOptions={{ color: PLAN_COLOR, weight: 4, dashArray: '10 8', interactive: false, lineCap: 'butt', lineJoin: 'round' }} />
            {picking && (
              <Polyline
                positions={pts}
                pathOptions={{ color: '#000', weight: 22, opacity: 0, bubblingMouseEvents: false }}
                eventHandlers={{ click: () => props.onSelect({ kind: 'line', id: l.id }) }}
              />
            )}
            {l.id === drawingId && pts.map((p, i) => (
              <CircleMarker key={i} center={p} radius={i === 0 ? 8 : 6} pathOptions={{ color: '#000', weight: 2, fillColor: i === 0 ? PLAN_SELECT : '#fff', fillOpacity: 1, interactive: false }} />
            ))}
          </Fragment>
        );
      })}

      {/* alcas do traçado escolhido: arrastar move o ponto, tocar escolhe, e o "+" do meio cria um ponto */}
      {picking && selLine && plan.lines.filter((l) => l.id === selLine).map((l) => (
        <Fragment key={`h-${l.id}`}>
          {midpoints(l).map((m) => (
            <Marker key={`m-${l.id}-${m.index}`} position={[m.lat, m.lng]} icon={midIcon} zIndexOffset={400}
              eventHandlers={{ click: () => props.onInsertVertex(l.id, m.index, m.lat, m.lng) }} />
          ))}
          {l.points.map((p, i) => (
            <Marker
              key={`v-${l.id}-${i}`}
              position={p}
              icon={handleIcon(selection?.kind === 'vertex' && selection.index === i)}
              draggable
              zIndexOffset={500}
              eventHandlers={{
                click: () => props.onSelect({ kind: 'vertex', lineId: l.id, index: i }),
                dragend: (e) => {
                  const ll = (e.target as { getLatLng(): { lat: number; lng: number } }).getLatLng();
                  props.onMoveVertex(l.id, i, ll.lat, ll.lng);
                },
              }}
            />
          ))}
        </Fragment>
      ))}

      {plan.points.map((p) => {
        const sel = selection?.kind === 'point' && selection.id === p.id;
        return (
          <Marker
            // `interactive` so e lida na criacao do marcador: mudar de ferramenta ou de escolha recria o ponto
            key={`${p.id}-${picking || sel ? 'i' : 'n'}`}
            position={[p.lat, p.lng]}
            icon={planPointIcon(TYPE_OF(p), sel)}
            interactive={picking || sel}
            draggable={picking && sel}
            zIndexOffset={sel ? 900 : 300}
            title={`${p.type}${p.code ? ` ${p.code}` : ''}`}
            eventHandlers={{
              click: () => props.onSelect({ kind: 'point', id: p.id }),
              dragend: (e) => {
                const ll = (e.target as { getLatLng(): { lat: number; lng: number } }).getLatLng();
                props.onMovePoint(p.id, ll.lat, ll.lng);
              },
            }}
          />
        );
      })}
    </MapContainer>
  );
}
