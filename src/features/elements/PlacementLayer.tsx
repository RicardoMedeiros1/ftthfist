import { useEffect } from 'react';
import type { Marker as LeafletMarker } from 'leaflet';
import { Circle, Marker, useMap, useMapEvents } from 'react-leaflet';
import { classifyAccuracy } from '../../lib/geo';
import { draftStore, useDraft } from './draftStore';
import { elementIcon } from './leafletIcon';

const MIN_ZOOM = 18;

/** Dentro do mapa: marcador do rascunho (arrastável quando preciso ajustar), círculo de precisão e toque no mapa. */
export default function PlacementLayer() {
  const map = useMap();
  const phase = useDraft((s) => s.phase);
  const type = useDraft((s) => s.type);
  const mode = useDraft((s) => s.mode);
  const capture = useDraft((s) => s.capture);
  const position = useDraft((s) => s.position);

  useMapEvents({
    click(e) {
      const s = draftStore.getState();
      if ((s.phase === 'posicao' && s.mode === 'manual') || s.phase === 'mover') {
        draftStore.setManualPosition(e.latlng.lat, e.latlng.lng);
      }
    },
  });

  // Centraliza no primeiro sinal e de novo quando a busca termina (não a cada leitura, para não brigar com o dedo).
  const hasPosition = position !== null;
  useEffect(() => {
    const s = draftStore.getState();
    if (s.phase !== 'posicao' || s.mode !== 'gps' || !s.position) return;
    map.setView([s.position.lat, s.position.lng], Math.max(map.getZoom(), MIN_ZOOM));
  }, [map, phase, mode, capture, hasPosition]);

  // Ao começar a mover, mostra o elemento no centro (uma vez por movimentação).
  const movingId = useDraft((s) => s.movingId);
  useEffect(() => {
    const s = draftStore.getState();
    if (s.phase !== 'mover' || !s.position) return;
    map.setView([s.position.lat, s.position.lng], Math.max(map.getZoom(), MIN_ZOOM));
  }, [map, movingId]);

  if ((phase !== 'posicao' && phase !== 'mover' && phase !== 'cabo') || !type || !position) return null;

  const searching = mode === 'gps' && capture === 'buscando';
  const bad = position.accuracy !== undefined && classifyAccuracy(position.accuracy) === 'ruim';
  // Arrasta quando a posição é manual (ajuste fino) ou quando o GPS ficou impreciso (> 15 m).
  const draggable = phase === 'mover' || (!searching && (position.source === 'manual' || bad));
  const color = bad ? '#ff9f0a' : '#1e90ff';

  return (
    <>
      {position.accuracy !== undefined && (
        <Circle
          center={[position.lat, position.lng]}
          radius={position.accuracy}
          pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.15, interactive: false }}
        />
      )}
      <Marker
        position={[position.lat, position.lng]}
        icon={elementIcon(type, 'draft')}
        draggable={draggable}
        zIndexOffset={1000}
        eventHandlers={{
          dragend(e) {
            const ll = (e.target as LeafletMarker).getLatLng();
            draftStore.dragTo(ll.lat, ll.lng);
          },
        }}
      />
    </>
  );
}
