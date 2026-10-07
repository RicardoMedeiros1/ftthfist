import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AdminBanner, EditedByNote } from '../../components/AdminNote';
import NotMineNote from '../../components/NotMineNote';
import ScreenShell from '../../components/ScreenShell';
import type { Activity } from '../../db/types';
import { formatDateTime, formatDuration } from '../../lib/format';
import { goBack, navigate } from '../../lib/route';
import { isMine } from '../../lib/ownership';
import { useCanEdit, useIsMine } from '../../lib/useOwnership';
import { ActivityRuleError, activities } from './activityRepo';
import { DEFAULT_FILTERS, activeFilterCount, filterActivities, ownerOptions, type ActivityFilters } from './filters';
import { finishQuestionFor } from '../projects/finishQuestion';
import FinishProjectDialog from '../projects/FinishProjectDialog';
import { isTodo } from '../projects/myProjects';
import { useMyProjects } from '../projects/useMyProjects';
import { KIND_LABEL } from './labels';
import './activities.css';

function ActivityCard({
  a,
  canReopen,
  onAction,
  onConclude,
}: {
  a: Activity;
  canReopen: boolean;
  onAction: (fn: () => Promise<void>) => void;
  /** Concluir: se a atividade veio de um projeto, a tela pergunta antes se o projeto terminou. */
  onConclude: (a: Activity) => void;
}) {
  const open = a.status === 'aberta';
  const mine = useIsMine(a);
  const editable = useCanEdit(a); // concluir/reabrir: o dono ou o administrador
  return (
    <article className={`card ${open ? 'card-open' : ''}`}>
      <div className="row">
        <span className={`badge badge-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
        <span className={`badge badge-status-${a.status}`}>{open ? 'Aberta' : 'Concluída'}</span>
      </div>
      <div className="card-title">{a.title}</div>
      <div className="card-meta">
        {a.osNumber ? `OS ${a.osNumber} · ` : ''}
        {a.technician}
      </div>
      <div className="card-meta">
        Início {formatDateTime(a.startedAt)}
        {a.endedAt ? ` · Fim ${formatDateTime(a.endedAt)} · ${formatDuration(a.endedAt - a.startedAt)}` : ''}
      </div>
      <EditedByNote record={a} />
      {!editable && <NotMineNote author={a.technician} what="atividade" />}
      {editable && !mine && <AdminBanner author={a.technician} what="atividade" />}
      <div className="card-actions">
        <button className="btn btn-small" onClick={() => navigate('atividade', { id: a.id })}>
          Abrir
        </button>
        {!editable ? null : open ? (
          <button className="btn btn-primary btn-small" onClick={() => onConclude(a)}>
            Concluir
          </button>
        ) : (
          <button
            className="btn btn-small"
            disabled={!canReopen}
            onClick={() => onAction(() => activities.reopen(a.id))}
          >
            Reabrir
          </button>
        )}
        <button className="btn btn-small" onClick={() => navigate('exportar', { id: a.id })}>
          Exportar
        </button>
      </div>
    </article>
  );
}

function Filters({
  value,
  onChange,
  owners,
  shown,
  total,
}: {
  value: ActivityFilters;
  onChange: (f: ActivityFilters) => void;
  owners: ReturnType<typeof ownerOptions>;
  shown: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const n = activeFilterCount({ ...value, query: '' }); // a busca ja esta a vista; o botao conta so os da gaveta
  const set = (patch: Partial<ActivityFilters>) => onChange({ ...value, ...patch });
  return (
    <section className="filters" aria-label="Filtros">
      <div className="filters-bar">
        <input type="search" aria-label="Buscar atividade por título, OS ou técnico" placeholder="Buscar…" value={value.query} onChange={(e) => set({ query: e.target.value })} />
        <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          Filtros{n > 0 && <span className="filter-count"> ({n})</span>}
        </button>
      </div>
      {open && (
        <div className="filters-panel">
          {owners.length > 0 && (
            <div className="field">
              <label htmlFor="flt-owner">Técnico</label>
              <select id="flt-owner" value={value.owner} onChange={(e) => set({ owner: e.target.value })}>
                <option value="todos">Todos</option>
                <option value="meus">Só as minhas</option>
                {owners.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} ({o.count})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="flt-kind">Tipo</label>
            <select id="flt-kind" value={value.kind} onChange={(e) => set({ kind: e.target.value as ActivityFilters['kind'] })}>
              <option value="todas">Todos</option>
              <option value="implantacao">Implantação</option>
              <option value="manutencao">Manutenção</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="flt-status">Situação</label>
            <select id="flt-status" value={value.status} onChange={(e) => set({ status: e.target.value as ActivityFilters['status'] })}>
              <option value="todas">Todas</option>
              <option value="aberta">Abertas</option>
              <option value="concluida">Concluídas</option>
            </select>
          </div>
        </div>
      )}
      {(n > 0 || value.query.trim() !== '') && (
        <div className="card-meta" role="status">
          {shown} de {total} atividades ·{' '}
          <button className="btn btn-small" onClick={() => onChange(DEFAULT_FILTERS)}>
            Limpar
          </button>
        </div>
      )}
    </section>
  );
}

export default function ActivitiesScreen() {
  const list = useLiveQuery(() => activities.list());
  const { rows: projectRows } = useMyProjects();
  const todoProjects = projectRows?.filter(isTodo).length ?? 0;
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const owners = useMemo(() => ownerOptions(list ?? []), [list]);
  const shown = useMemo(() => filterActivities(list ?? [], filters), [list, filters]);

  // so a MINHA atividade aberta impede de iniciar outra (a de um colega e dele)
  const hasOpen = list?.some((a) => a.status === 'aberta' && isMine(a)) ?? false;
  // reabrir: so se o DONO daquela atividade nao tiver outra aberta (o administrador reabre a de um tecnico)
  const ownersWithOpen = new Set((list ?? []).filter((a) => a.status === 'aberta').map((a) => a.ownerId ?? ''));

  function run(fn: () => Promise<void>) {
    setError(null);
    fn().catch((err: unknown) =>
      setError(err instanceof ActivityRuleError ? err.message : 'Não foi possível concluir a ação.'),
    );
  }

  // Atividade de projeto: ao concluir, pergunta se o projeto terminou
  const [asking, setAsking] = useState<{ activity: Activity; projectTitle: string } | null>(null);
  function conclude(a: Activity) {
    run(async () => {
      const q = await finishQuestionFor(a);
      if (q) setAsking({ activity: a, projectTitle: q.title });
      else await activities.complete(a.id);
    });
  }

  return (
    <ScreenShell title="Atividades" onBack={() => goBack('map')}>
      {projectRows !== undefined && projectRows.length > 0 && (
        <button className="btn btn-block" onClick={() => navigate('meus-projetos')}>
          Meus projetos{todoProjects > 0 ? ` (${todoProjects} para fazer)` : ''}
        </button>
      )}
      <button className="btn btn-primary btn-block" disabled={list === undefined || hasOpen} onClick={() => navigate('nova-atividade')}>
        + Nova atividade
      </button>
      {hasOpen && <p className="hint">Só uma atividade pode ficar aberta. Conclua a atual para iniciar outra.</p>}
      {error && <div className="alert" role="alert">{error}</div>}

      {list !== undefined && list.length > 0 && <Filters value={filters} onChange={setFilters} owners={owners} shown={shown.length} total={list.length} />}

      {list === undefined ? null : list.length === 0 ? (
        <p className="hint">Nenhuma atividade ainda. Toque em “Nova atividade” para começar.</p>
      ) : shown.length === 0 ? (
        <p className="hint">Nenhuma atividade com esses filtros.</p>
      ) : (
        shown.map((a) => <ActivityCard key={a.id} a={a} canReopen={!ownersWithOpen.has(a.ownerId ?? '')} onAction={run} onConclude={conclude} />)
      )}
      {asking && (
        <FinishProjectDialog
          projectTitle={asking.projectTitle}
          onCancel={() => setAsking(null)}
          onChoose={(finishes) => {
            const id = asking.activity.id;
            setAsking(null);
            run(() => activities.complete(id, { finishesProject: finishes }));
          }}
        />
      )}
    </ScreenShell>
  );
}
