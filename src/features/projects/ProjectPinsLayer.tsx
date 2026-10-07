import { Marker } from 'react-leaflet';
import { navigate } from '../../lib/route';
import { projectPinIcon } from './projectPinIcon';
import { useMyProjects } from './useMyProjects';

// Os pontos dos projetos que faltam fazer, no mapa do tecnico. Tocar abre o projeto.

export default function ProjectPinsLayer() {
  const { todo } = useMyProjects();
  return (
    <>
      {(todo ?? []).map((r) =>
        r.project.lat !== undefined && r.project.lng !== undefined ? (
          <Marker
            key={r.project.id}
            position={[r.project.lat, r.project.lng]}
            icon={projectPinIcon}
            title={`Projeto: ${r.project.title}`}
            zIndexOffset={500}
            eventHandlers={{ click: () => navigate('meu-projeto', { id: r.project.id }) }}
          />
        ) : null,
      )}
    </>
  );
}
