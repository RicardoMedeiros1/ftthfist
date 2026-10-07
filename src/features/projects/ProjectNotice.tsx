import { useState } from 'react';
import { navigate, useRoute } from '../../lib/route';
import { useDraft } from '../elements/draftStore';
import { noticeText } from './myProjects';
import { useMyProjects } from './useMyProjects';
import './projects.css';

// "Você tem N projetos para fazer": aparece ao abrir o app (e quando chega projeto novo), so no mapa e fora de uma marcacao.
// "Depois" esconde ate o app ser aberto de novo ou chegar um projeto novo (a lembranca fica so na memoria, de proposito).

let dismissedFor = '';

export default function ProjectNotice() {
  const route = useRoute();
  const idle = useDraft((s) => s.phase === 'idle');
  const { todo } = useMyProjects();
  const [, rerender] = useState(0);
  if (route !== 'map' || !idle || !todo || todo.length === 0) return null;
  const key = todo.map((r) => r.project.id).sort().join(',');
  if (dismissedFor === key) return null;
  const only = todo.length === 1 ? todo[0]!.project : null;

  return (
    <div className="project-toast" role="status">
      <span>
        {noticeText(todo.length)}
        {only && <span className="project-toast-sub">{only.title}</span>}
      </span>
      <div className="update-actions">
        <button
          className="btn btn-small"
          onClick={() => {
            dismissedFor = key;
            rerender((n) => n + 1);
          }}
        >
          Depois
        </button>
        <button className="btn btn-primary btn-small" onClick={() => (only ? navigate('meu-projeto', { id: only.id }) : navigate('meus-projetos'))}>
          Ver
        </button>
      </div>
    </div>
  );
}
