import { KIND_LABEL } from '../activities/labels';
import { formatDueDate, STATE_LABEL, type ProjectRow } from './projectState';
import './projects.css';

/** Cartao de um projeto nas listas. `showTechnician` = false na lista do proprio tecnico (o nome seria sempre o dele). */
export default function ProjectCard({ row, onOpen, showTechnician = true }: { row: ProjectRow; onOpen: () => void; showTechnician?: boolean }) {
  const { project: p, state } = row;
  const done = row.linked.filter((a) => !a.deleted).length;
  return (
    <li>
      <button className="card project-card" data-state={state} data-overdue={row.overdue} onClick={onOpen}>
        <span className="project-head">
          <span className="card-title">{p.title}</span>
          <span className="project-badges">
            <span className={`badge badge-state-${state}`}>{STATE_LABEL[state]}</span>
            {row.overdue && <span className="badge badge-overdue">Atrasado</span>}
          </span>
        </span>
        <span className="card-meta">{KIND_LABEL[p.kind]}{p.osNumber ? ` · OS ${p.osNumber}` : ''}{showTechnician ? ` · ${row.technicianName}` : ''}</span>
        {p.address && <span className="card-meta">{p.address}</span>}
        <span className="card-meta">
          {p.dueDate ? `Prazo ${formatDueDate(p.dueDate)}` : 'Sem prazo'} · {done === 0 ? 'nenhuma atividade ainda' : done === 1 ? '1 atividade' : `${done} atividades`}
        </span>
      </button>
    </li>
  );
}
