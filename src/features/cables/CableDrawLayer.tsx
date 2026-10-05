import { CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { draftStore, useDraft } from '../elements/draftStore';
import { addVertexAtMapPoint } from './cableActions';
import { useCableDraft } from './cableDraft';
import { CASING_COLOR, CASING_EXTRA, cableStyle } from './style';

/** O cabo em lançamento: a linha, os pontos e o toque no mapa que adiciona pontos (grudando em elementos a ≤ 25 px). */
export default function CableDrawLayer() {
  const map = useMap();
  const phase = useDraft((s) => s.phase);
  const draft = useCableDraft((d) => d);

  useMapEvents({
    click(e) {
      const s = draftStore.getState();
      // Com um ponto de precisão baixa aguardando ajuste, o toque no mapa não adiciona nada.
      if (s.phase === 'cabo' && !s.position) void addVertexAtMapPoint(map, e.latlng);
    },
  });

  if (phase !== 'cabo' || !draft) return null;
  const st = cableStyle(draft.fiberCount);
  const pts = draft.vertices.map((v) => [v.lat, v.lng] as [number, number]);
  const lastIndex = draft.vertices.length - 1;
  const round = { lineCap: 'round', lineJoin: 'round', interactive: false } as const;
  return (
    <>
      {pts.length >= 2 && (
        <>
          <Polyline positions={pts} pathOptions={{ color: CASING_COLOR, weight: st.weight + CASING_EXTRA, ...round }} />
          <Polyline positions={pts} pathOptions={{ color: st.color, weight: st.weight, ...round }} />
        </>
      )}
      {draft.vertices.map((v, i) => (
        <CircleMarker
          key={`${i}-${v.lat}-${v.lng}`}
          center={[v.lat, v.lng]}
          radius={i === lastIndex ? 9 : 6}
          pathOptions={{ color: '#000', weight: 3, fillColor: i === lastIndex ? '#ffd400' : '#ffffff', fillOpacity: 1, interactive: false }}
        />
      ))}
    </>
  );
}
