import { useLiveQuery } from 'dexie-react-hooks';
import { Marker, useMap } from 'react-leaflet';
import { navigate } from '../../lib/route';
import { activities } from '../activities/activityRepo';
import { draftStore, useDraft } from './draftStore';
import { elementStore } from './elementRepo';
import { elementIcon } from './leafletIcon';

/** Elementos de todas as atividades; os da atividade aberta ficam grandes e com halo amarelo. */
export default function ElementsLayer() {
  const map = useMap();
  const list = useLiveQuery(() => elementStore.list());
  const open = useLiveQuery(() => activities.getOpen());
  const movingId = useDraft((s) => s.movingId);
  if (!list) return null;
  return (
    <>
      {list.filter((e) => e.id !== movingId).map((e) => {
        const current = open !== undefined && open !== null && e.activityId === open.id;
        return (
          <Marker
            key={e.id}
            position={[e.lat, e.lng]}
            icon={elementIcon(e.type, current ? 'highlighted' : 'dim')}
            zIndexOffset={current ? 100 : 0}
            eventHandlers={{
              click(ev) {
                const s = draftStore.getState();
                if (s.phase === 'idle') {
                  navigate('elemento', { id: e.id });
                } else if ((s.phase === 'posicao' && s.mode === 'manual') || s.phase === 'mover') {
                  // Ao marcar/mover pelo toque, um ícone no caminho não pode "roubar" o ponto:
                  // usa o lugar tocado, e não a posição do ícone.
                  const ll = map.mouseEventToLatLng(ev.originalEvent as MouseEvent);
                  draftStore.setManualPosition(ll.lat, ll.lng);
                }
              },
            }}
          />
        );
      })}
    </>
  );
}
