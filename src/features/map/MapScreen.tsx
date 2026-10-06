import { useCallback, useEffect, useRef, useState } from 'react';
import { DomEvent } from 'leaflet';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { SETTING_KEYS, getSetting, setSetting } from '../../db/db';
import { classifyAccuracy, formatAccuracy } from '../../lib/geo';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import ActivityBar from '../activities/ActivityBar';
import CableDrawLayer from '../cables/CableDrawLayer';
import CableEditLayer from '../cables/CableEditLayer';
import CableEditPanel from '../cables/CableEditPanel';
import CableGps from '../cables/CableGps';
import CablePanel from '../cables/CablePanel';
import CablesLayer from '../cables/CablesLayer';
import { cableStore } from '../cables/cableRepo';
import { LegendSheet } from '../cables/Legend';
import TrackLayer from '../tracking/TrackLayer';
import { useTrack } from '../tracking/trackRecorder';
import { navigate } from '../../lib/route';
import { useLiveQuery } from 'dexie-react-hooks';
import AddButton from '../elements/AddButton';
import { useDraft } from '../elements/draftStore';
import ElementsLayer from '../elements/ElementsLayer';
import GpsCaptureHost from '../elements/GpsCapture';
import MovePanel from '../elements/MovePanel';
import PlacementLayer from '../elements/PlacementLayer';
import PlacementPanel from '../elements/PlacementPanel';
import TypePicker from '../elements/TypePicker';
import '../elements/elements.css';
import { BASE_LAYERS, type BaseLayerId } from './layers';
import { useGeolocation, type LocateMode, type LocationFix } from './useGeolocation';
import './map.css';
import '../tracking/tracking.css';

interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

// Brasil inteiro até o primeiro GPS ou até haver uma visão salva.
const DEFAULT_VIEW: MapView = { lat: -14.2, lng: -51.9, zoom: 4 };
const FOLLOW_MIN_ZOOM = 17;

/** Salva a última visão (para reabrir offline no mesmo lugar). */
function PersistView() {
  const map = useMap();
  useMapEvents({
    moveend() {
      const c = map.getCenter();
      void setSetting(SETTING_KEYS.mapView, { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    },
  });
  return null;
}

/** Faz o mapa acompanhar o GPS; arrastar com o dedo solta o modo seguir. */
function FollowLocation({
  fix,
  mode,
  onRelease,
}: {
  fix: LocationFix | null;
  mode: LocateMode;
  onRelease: () => void;
}) {
  const map = useMap();
  useMapEvents({ dragstart: onRelease });

  useEffect(() => {
    if (mode !== 'following' || !fix) return;
    map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), FOLLOW_MIN_ZOOM));
  }, [fix, mode, map]);

  return null;
}

function LocationMarker({ fix }: { fix: LocationFix }) {
  const bad = classifyAccuracy(fix.accuracy) === 'ruim';
  const color = bad ? '#ff9f0a' : '#1e90ff';
  return (
    <>
      <Circle
        center={[fix.lat, fix.lng]}
        radius={fix.accuracy}
        pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.15, interactive: false }}
      />
      <CircleMarker
        center={[fix.lat, fix.lng]}
        radius={9}
        pathOptions={{ color: '#fff', weight: 3, fillColor: color, fillOpacity: 1, interactive: false }}
      />
    </>
  );
}

function ZoomButtons() {
  const map = useMap();
  const ref = useRef<HTMLDivElement>(null);
  // Toques nos botões não podem virar cliques/arrastos no mapa por baixo.
  useEffect(() => {
    if (!ref.current) return;
    DomEvent.disableClickPropagation(ref.current);
    DomEvent.disableScrollPropagation(ref.current);
  }, []);
  return (
    <div ref={ref} className="map-btn-group" role="group" aria-label="Zoom">
      <button className="map-btn" aria-label="Aproximar" onClick={() => map.zoomIn()}>
        +
      </button>
      <button className="map-btn" aria-label="Afastar" onClick={() => map.zoomOut()}>
        −
      </button>
    </div>
  );
}

export default function MapScreen() {
  const [initial, setInitial] = useState<{ view: MapView } | null>(null);
  const [layerId, setLayerId] = useState<BaseLayerId>('ruas');
  // Camada imposta pela marcação (satélite quando o GPS está impreciso); não altera a preferência salva.
  const [layerOverride, setLayerOverride] = useState<BaseLayerId | null>(null);
  const online = useOnlineStatus();
  const { fix, mode, error, toggle, release } = useGeolocation();

  const phase = useDraft((s) => s.phase);
  const badGps = useDraft(
    (s) =>
      s.position?.source === 'gps' &&
      s.capture === 'concluido' &&
      s.position.accuracy !== undefined &&
      classifyAccuracy(s.position.accuracy) === 'ruim',
  );
  const placing = phase !== 'idle';
  const lancando = phase === 'cabo' || phase === 'cabo-editar';
  const hasCables = (useLiveQuery(() => cableStore.list())?.length ?? 0) > 0;
  const [legendOpen, setLegendOpen] = useState(false);
  const trackStatus = useTrack((t) => t.status);

  useEffect(() => {
    void (async () => {
      const [view, layer] = await Promise.all([
        getSetting<MapView>(SETTING_KEYS.mapView, DEFAULT_VIEW),
        getSetting<BaseLayerId>(SETTING_KEYS.baseLayer, 'ruas'),
      ]);
      setLayerId(layer);
      setInitial({ view });
    })();
  }, []);

  // Ao iniciar a marcação o mapa para de seguir o GPS (senão brigaria com o ajuste do ponto).
  // Ao lançar cabo é o contrário: o técnico anda, então o mapa liga o GPS e acompanha.
  useEffect(() => {
    if (placing && !lancando) release();
  }, [placing, lancando, release]);
  useEffect(() => {
    if (phase === 'cabo' && mode === 'off') toggle();
    // só ao entrar no modo cabo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // GPS impreciso (> 15 m): satélite para ajustar o ponto. Continua assim até o fim da marcação,
  // mesmo depois de arrastar (quando a posição deixa de ser "GPS").
  useEffect(() => {
    if (badGps) setLayerOverride('satelite');
  }, [badGps]);
  // Mover um elemento ou ajustar o traçado é ajuste fino: satélite para enxergar onde as coisas realmente ficam.
  useEffect(() => {
    if (phase === 'mover' || phase === 'cabo-editar') setLayerOverride('satelite');
  }, [phase]);
  useEffect(() => {
    if (!placing) setLayerOverride(null);
  }, [placing]);

  const effectiveLayer = layerOverride ?? layerId;
  const switchLayer = useCallback(() => {
    const next: BaseLayerId = effectiveLayer === 'ruas' ? 'satelite' : 'ruas';
    setLayerOverride(null);
    setLayerId(next);
    void setSetting(SETTING_KEYS.baseLayer, next);
  }, [effectiveLayer]);

  if (!initial) return null;
  const layer = BASE_LAYERS[effectiveLayer];
  const nextLayerLabel = BASE_LAYERS[effectiveLayer === 'ruas' ? 'satelite' : 'ruas'].label;

  return (
    <div className={`map-screen phase-${phase}${legendOpen ? ' legend-open' : ''}`}>
      <MapContainer
        center={[initial.view.lat, initial.view.lng]}
        zoom={initial.view.zoom}
        zoomControl={false}
        className="map-canvas"
      >
        {/* crossOrigin evita respostas "opacas", que o navegador contabiliza com ~7 MB cada no cache offline */}
        <TileLayer
          key={layer.id}
          url={layer.url}
          attribution={layer.attribution}
          maxZoom={layer.maxZoom}
          crossOrigin="anonymous"
        />
        {fix && <LocationMarker fix={fix} />}
        <TrackLayer />
        <CablesLayer />
        <ElementsLayer />
        <CableDrawLayer />
        <CableEditLayer />
        <PlacementLayer />
        <FollowLocation fix={fix} mode={mode} onRelease={release} />
        <PersistView />
        <ZoomButtons />
      </MapContainer>

      <ActivityBar />

      <div className={`net-pill ${online ? 'net-online' : 'net-offline'}`} role="status">
        <span className="net-dot" aria-hidden="true" />
        {online ? 'Online' : 'Offline'}
      </div>

      <div className="map-controls">
        {hasCables && phase === 'idle' && (
          <button className="map-btn map-btn-wide" onClick={() => setLegendOpen(true)}>
            Legenda
          </button>
        )}
        {phase === 'idle' && (
          <button
            className="map-btn map-btn-wide"
            onClick={() => navigate('trilha')}
            aria-label={trackStatus === 'parada' ? 'Trilha GPS' : trackStatus === 'gravando' ? 'Trilha GPS: gravando' : 'Trilha GPS: pausada'}
          >
            {trackStatus !== 'parada' && <span className={`rec-dot ${trackStatus === 'pausada' ? 'rec-dot-pause' : ''}`} aria-hidden="true" />}
            Trilha
          </button>
        )}
        <button className="map-btn map-btn-wide" onClick={switchLayer} aria-label={`Trocar para ${nextLayerLabel}`}>
          {nextLayerLabel}
        </button>
        <button
          className={`map-btn locate-${mode}`}
          onClick={toggle}
          aria-label="Minha localização"
          aria-pressed={mode === 'following'}
        >
          ◎
        </button>
      </div>

      {!placing && (fix || error) && (
        <div className={`gps-banner ${fix && classifyAccuracy(fix.accuracy) === 'ruim' ? 'gps-warn' : ''}`} role="status">
          {error ?? (fix ? `GPS ${formatAccuracy(fix.accuracy)}${classifyAccuracy(fix.accuracy) === 'ruim' ? ' · baixa' : ''}` : '')}
        </div>
      )}

      <AddButton />
      <TypePicker />
      <PlacementPanel />
      <MovePanel />
      <CablePanel />
      <CableEditPanel />
      <CableGps />
      {legendOpen && <LegendSheet onClose={() => setLegendOpen(false)} />}
      <GpsCaptureHost />
    </div>
  );
}
