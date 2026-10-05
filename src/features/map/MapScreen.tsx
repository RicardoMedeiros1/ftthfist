import { useCallback, useEffect, useRef, useState } from 'react';
import { DomEvent } from 'leaflet';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { SETTING_KEYS, getSetting, setSetting } from '../../db/db';
import { classifyAccuracy, formatAccuracy } from '../../lib/geo';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { BASE_LAYERS, type BaseLayerId } from './layers';
import { useGeolocation, type LocateMode, type LocationFix } from './useGeolocation';
import './map.css';

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
  const [initial, setInitial] = useState<{ view: MapView; layer: BaseLayerId } | null>(null);
  const [layerId, setLayerId] = useState<BaseLayerId>('ruas');
  const online = useOnlineStatus();
  const { fix, mode, error, toggle, release } = useGeolocation();

  useEffect(() => {
    void (async () => {
      const [view, layer] = await Promise.all([
        getSetting<MapView>(SETTING_KEYS.mapView, DEFAULT_VIEW),
        getSetting<BaseLayerId>(SETTING_KEYS.baseLayer, 'ruas'),
      ]);
      setLayerId(layer);
      setInitial({ view, layer });
    })();
  }, []);

  const switchLayer = useCallback(() => {
    setLayerId((cur) => {
      const next: BaseLayerId = cur === 'ruas' ? 'satelite' : 'ruas';
      void setSetting(SETTING_KEYS.baseLayer, next);
      return next;
    });
  }, []);

  if (!initial) return null;
  const layer = BASE_LAYERS[layerId];
  const nextLayerLabel = BASE_LAYERS[layerId === 'ruas' ? 'satelite' : 'ruas'].label;

  return (
    <div className="map-screen">
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
        <FollowLocation fix={fix} mode={mode} onRelease={release} />
        <PersistView />
        <ZoomButtons />
      </MapContainer>

      <div className={`net-pill ${online ? 'net-online' : 'net-offline'}`} role="status">
        <span className="net-dot" aria-hidden="true" />
        {online ? 'Online' : 'Offline'}
      </div>

      <div className="map-controls">
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

      {(fix || error) && (
        <div className={`gps-banner ${fix && classifyAccuracy(fix.accuracy) === 'ruim' ? 'gps-warn' : ''}`} role="status">
          {error ?? (fix ? `GPS ${formatAccuracy(fix.accuracy)}${classifyAccuracy(fix.accuracy) === 'ruim' ? ' — precisão baixa' : ''}` : '')}
        </div>
      )}
    </div>
  );
}
