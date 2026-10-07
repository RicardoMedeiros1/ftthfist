import type { Activity } from '../../db/types';
import { formatDateTime } from '../../lib/format';
import { formatMeters } from '../../lib/geo';
import { navigate } from '../../lib/route';
import { useAccount } from '../account/accountStore';
import { KIND_LABEL } from '../activities/labels';
import { formatDueDate, STATE_LABEL } from '../projects/projectState';
import '../projects/projects.css';
import { panelMapStore } from './panelMapStore';
import { panelTableStore } from './panelTableStore';
import type { ProjectTableRow } from './projectTable';

/** A ficha de um projeto no painel (so leitura): situacao, instrucoes, local e as atividades feitas nele. */
export default function ProjectInfo({ row, activities }: { row: ProjectTableRow; activities: readonly Activity[] }) {
  const isAdmin = useAccount((a) => a.status === 'ativo' && a.profile?.role === 'admin');
  const { project: p, state } = row;
  const mine = activities.filter((a) => a.projectId === p.id && !a.deleted).sort((a, b) => a.startedAt - b.startedAt);
  const hasPoint = p.lat !== undefined && p.lng !== undefined;

  return (
    <>
      <div>
        <div className="card-title">{p.title}</div>
        <div className="project-badges">
          <span className={`badge badge-state-${state}`}>{STATE_LABEL[state]}</span>
          {row.overdue && <span className="badge badge-overdue">Atrasado</span>}
        </div>
      </div>
      <dl className="project-facts">
        <dt>Técnico</dt>
        <dd>{row.technicianName}</dd>
        <dt>Tipo</dt>
        <dd>{KIND_LABEL[p.kind]}</dd>
        {p.osNumber && (
          <>
            <dt>OS</dt>
            <dd>{p.osNumber}</dd>
          </>
        )}
        <dt>Prazo</dt>
        <dd>{p.dueDate ? formatDueDate(p.dueDate) : 'Sem prazo'}</dd>
        {p.address && (
          <>
            <dt>Local</dt>
            <dd>{p.address}</dd>
          </>
        )}
        <dt>Criado em</dt>
        <dd>{formatDateTime(p.createdAt)}</dd>
      </dl>
      {p.description && (
        <section aria-label="Instruções">
          <span className="label">Instruções</span>
          <p className="project-instructions">{p.description}</p>
        </section>
      )}
      <div className="totals" aria-label="O que foi feito neste projeto">
        <div className="total-tile"><strong>{row.activities}</strong><span>{row.activities === 1 ? 'atividade' : 'atividades'}</span></div>
        <div className="total-tile"><strong>{row.elements}</strong><span>{row.elements === 1 ? 'elemento' : 'elementos'}</span></div>
        <div className="total-tile"><strong>{row.cables}</strong><span>{row.cables === 1 ? 'cabo' : 'cabos'}</span></div>
        <div className="total-tile"><strong>{formatMeters(row.meters)}</strong><span>de cabo</span></div>
      </div>
      {hasPoint && (
        <button
          className="btn"
          onClick={() => {
            panelMapStore.showProjectPoint({ lat: p.lat!, lng: p.lng!, title: p.title });
            navigate('painel', { id: 'mapa' });
          }}
        >
          Ver o ponto no mapa
        </button>
      )}
      <section aria-label="Atividades do projeto">
        <span className="label">Atividades deste projeto ({mine.length})</span>
        {mine.length === 0 ? (
          <p className="hint">Ainda não começou: nenhuma atividade ligada a este projeto.</p>
        ) : (
          <ul className="project-linked">
            {mine.map((a) => (
              <li key={a.id}>
                <button
                  className="btn"
                  onClick={() => {
                    panelTableStore.select(a.id);
                    navigate('painel', { id: 'atividades' });
                  }}
                >
                  {a.title} · {a.technician} · {a.status === 'concluida' ? 'concluída' : 'em aberto'}{a.completesProject ? ' · terminou o projeto' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {isAdmin && (
        <button className="btn" onClick={() => navigate('projeto', { id: p.id })}>
          Editar projeto (administrador)
        </button>
      )}
    </>
  );
}
