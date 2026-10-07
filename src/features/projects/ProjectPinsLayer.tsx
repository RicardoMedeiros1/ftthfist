import { divIcon } from 'leaflet';
import { Marker } from 'react-leaflet';
import { navigate } from '../../lib/route';
import { useMyProjects } from './useMyProjects';

// Os pontos dos projetos que faltam fazer, no mapa do tecnico. Tocar abre o projeto.

const BOX = 48;
const icon = divIcon({
  className: 'project-pin',
  html: `<div class="el-hit" style="width:${BOX}px;height:${BOX}px"><svg viewBox="0 0 32 40" width="36" height="44" aria-hidden="true"><path d="M16 38C16 38 4 24 4 14a12 12 0 1 1 24 0C28 24 16 38 16 38Z" fill="#ffd60a" stroke="#000" stroke-width="3"/><circle cx="16" cy="14" r="5" fill="#000"/></svg></div>`,
  iconSize: [BOX, BOX],
  iconAnchor: [BOX / 2, BOX - 4],
});

export default function ProjectPinsLayer() {
  const { todo } = useMyProjects();
  return (
    <>
      {(todo ?? []).map((r) =>
        r.project.lat !== undefined && r.project.lng !== undefined ? (
          <Marker
            key={r.project.id}
            position={[r.project.lat, r.project.lng]}
            icon={icon}
            title={`Projeto: ${r.project.title}`}
            zIndexOffset={500}
            eventHandlers={{ click: () => navigate('meu-projeto', { id: r.project.id }) }}
          />
        ) : null,
      )}
    </>
  );
}
