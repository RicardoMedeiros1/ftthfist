import { useLiveQuery } from 'dexie-react-hooks';
import { divIcon, type Marker as LeafletMarker } from 'leaflet';
import { Marker } from 'react-leaflet';
import { draftStore, useDraft } from '../elements/draftStore';
import { cableStore } from './cableRepo';

// Alças do traçado em edição. A área de toque é de 48 px; o desenho é menor.
const HIT = 48;
function handle(kind: 'element' | 'loose' | 'mid', selected: boolean) {
  return divIcon({
    className: 'el-icon',
    html: `<div class="el-hit" style="width:${HIT}px;height:${HIT}px"><span class="handle handle-${kind}${selected ? ' handle-selected' : ''}"></span></div>`,
    iconSize: [HIT, HIT],
    iconAnchor: [HIT / 2, HIT / 2],
  });
}

/** Alças para arrastar cada ponto e "+" no meio de cada trecho para inserir um ponto novo. */
export default function CableEditLayer() {
  const phase = useDraft((s) => s.phase);
  const id = useDraft((s) => s.editingCableId);
  const selected = useDraft((s) => s.selectedVertex);
  const cable = useLiveQuery(async () => (id ? ((await cableStore.get(id)) ?? null) : null), [id]);
  if (phase !== 'cabo-editar' || !cable) return null;

  const vs = cable.vertices;
  return (
    <>
      {vs.map((v, i) => (
        <Marker
          // A chave inclui a posição: depois de gravar, a alça é recriada exatamente no lugar novo.
          key={`v${i}-${v.lat}-${v.lng}`}
          position={[v.lat, v.lng]}
          icon={handle(v.elementId ? 'element' : 'loose', selected === i)}
          draggable
          zIndexOffset={1000}
          eventHandlers={{
            dragend(e) {
              const ll = (e.target as LeafletMarker).getLatLng();
              draftStore.selectVertex(i);
              void cableStore.moveVertex(cable.id, i, { lat: ll.lat, lng: ll.lng }).catch(() => undefined);
            },
            click() {
              draftStore.selectVertex(i);
            },
          }}
        />
      ))}
      {vs.slice(0, -1).map((v, i) => {
        const n = vs[i + 1]!;
        const mid = { lat: (v.lat + n.lat) / 2, lng: (v.lng + n.lng) / 2 };
        return (
          <Marker
            key={`m${i}-${v.lat}-${v.lng}-${n.lat}-${n.lng}`}
            position={[mid.lat, mid.lng]}
            icon={handle('mid', false)}
            zIndexOffset={900}
            eventHandlers={{
              click() {
                void cableStore
                  .insertVertex(cable.id, i, mid)
                  .then(() => draftStore.selectVertex(i + 1))
                  .catch(() => undefined);
              },
            }}
          />
        );
      })}
    </>
  );
}
