import { Fragment } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Polyline } from 'react-leaflet';
import { navigate } from '../../lib/route';
import { draftStore } from '../elements/draftStore';
import { cableStore } from './cableRepo';
import { CASING_COLOR, CASING_EXTRA, cableStyle } from './style';

/** Cabos salvos: linha colorida pelas fibras, com contorno preto e uma faixa larga invisível para facilitar o toque. */
export default function CablesLayer() {
  const list = useLiveQuery(() => cableStore.list());
  if (!list) return null;
  return (
    <>
      {list.map((c) => {
        const st = cableStyle(c.fiberCount);
        const pts = c.vertices.map((v) => [v.lat, v.lng] as [number, number]);
        const round = { lineCap: 'round', lineJoin: 'round' } as const;
        return (
          <Fragment key={c.id}>
            <Polyline positions={pts} pathOptions={{ color: CASING_COLOR, weight: st.weight + CASING_EXTRA, interactive: false, ...round }} />
            <Polyline positions={pts} pathOptions={{ color: st.color, weight: st.weight, interactive: false, ...round }} />
            {/* Faixa de toque (~24 px). Fora do "idle" o clique segue para o mapa (marcar/mover/lançar). */}
            <Polyline
              positions={pts}
              pathOptions={{ color: '#000', weight: 24, opacity: 0 }}
              eventHandlers={{
                click() {
                  if (draftStore.getState().phase === 'idle') navigate('cabo', { id: c.id });
                },
              }}
            />
          </Fragment>
        );
      })}
    </>
  );
}
