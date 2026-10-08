import { Fragment } from 'react';
import { CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { draftStore, useDraft } from '../elements/draftStore';
import { addVertexAtMapPoint } from './cableActions';
import { activeCable, useCableDraft } from './cableDraft';
import { CASING_COLOR, CASING_EXTRA, cableStyle } from './style';

/** O lançamento: o tronco e os ramais, os pontos e o toque no mapa que adiciona pontos ao cabo ativo (grudando em elementos a ≤ 25 px). */
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
  const active = activeCable(draft);
  const round = { lineCap: 'round', lineJoin: 'round', interactive: false } as const;
  return (
    <>
      {draft.cables.map((c) => {
        const st = cableStyle(c.fiberCount);
        const pts = c.vertices.map((v) => [v.lat, v.lng] as [number, number]);
        const isActive = c.cableId === active.cableId;
        const lastIndex = c.vertices.length - 1;
        return (
          <Fragment key={c.cableId}>
            {pts.length >= 2 && (
              <>
                <Polyline positions={pts} pathOptions={{ color: CASING_COLOR, weight: st.weight + CASING_EXTRA, ...round }} />
                <Polyline positions={pts} pathOptions={{ color: st.color, weight: st.weight, ...round }} />
              </>
            )}
            {c.vertices.map((v, i) => {
              const here = isActive && i === lastIndex;
              return (
                <CircleMarker
                  key={`${i}-${v.lat}-${v.lng}`}
                  center={[v.lat, v.lng]}
                  radius={here ? 9 : 6}
                  pathOptions={{ color: '#000', weight: 3, fillColor: here ? '#ffd400' : '#ffffff', fillOpacity: 1, interactive: false }}
                />
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}
