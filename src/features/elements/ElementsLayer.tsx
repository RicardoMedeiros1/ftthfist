import { useLiveQuery } from 'dexie-react-hooks';
import { Marker } from 'react-leaflet';
import { activities } from '../activities/activityRepo';
import { elementStore } from './elementRepo';
import { elementIcon } from './leafletIcon';

/** Elementos de todas as atividades; os da atividade aberta ficam grandes e com halo amarelo. */
export default function ElementsLayer() {
  const list = useLiveQuery(() => elementStore.list());
  const open = useLiveQuery(() => activities.getOpen());
  if (!list) return null;
  return (
    <>
      {list.map((e) => {
        const current = open !== undefined && open !== null && e.activityId === open.id;
        return (
          <Marker
            key={e.id}
            position={[e.lat, e.lng]}
            icon={elementIcon(e.type, current ? 'highlighted' : 'dim')}
            zIndexOffset={current ? 100 : 0}
            // Sem toque por enquanto (o detalhe vem na 4b): assim "tocar no mapa" funciona sobre qualquer ponto.
            interactive={false}
            keyboard={false}
          />
        );
      })}
    </>
  );
}
