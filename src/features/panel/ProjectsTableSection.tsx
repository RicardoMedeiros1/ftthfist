import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../../db/db';
import { formatMeters } from '../../lib/geo';
import { downloadFile } from '../../lib/share';
import { KIND_LABEL } from '../activities/labels';
import { countByState, formatDueDate, STATE_FILTERS, STATE_LABEL, type StateFilter } from '../projects/projectState';
import { usePeopleNames } from '../projects/usePeopleNames';
import ProjectInfo from './ProjectInfo';
import { panelProjectsStore, usePanelProjects } from './panelProjectsStore';
import { activeProjectFilterCount, buildProjectTableRows, filterProjectRows, projectTotalsOf, projectsCsv, projectsFileName, sortProjectRows, type ProjectSortKey, type ProjectTableRow } from './projectTable';

const COLUMNS: { key: ProjectSortKey; label: string; numeric?: boolean }[] = [
  { key: 'title', label: 'Projeto' },
  { key: 'technician', label: 'Técnico' },
  { key: 'kind', label: 'Tipo' },
  { key: 'state', label: 'Situação' },
  { key: 'dueDate', label: 'Prazo' },
  { key: 'activities', label: 'Atividades', numeric: true },
  { key: 'meters', label: 'Metros de cabo', numeric: true },
];

function Cells({ r }: { r: ProjectTableRow }) {
  return (
    <>
      <td data-col="title" data-label="Projeto">
        <button className="panel-row-btn" onClick={() => panelProjectsStore.select(r.id)}>
          <strong>{r.title}</strong>
          {r.osNumber && <small>OS {r.osNumber}</small>}
        </button>
      </td>
      <td data-col="technician" data-label="Técnico">{r.technicianName}</td>
      <td data-col="kind" data-label="Tipo">{KIND_LABEL[r.project.kind]}</td>
      <td data-col="state" data-label="Situação">
        <span className={`badge badge-state-${r.state}`}>{STATE_LABEL[r.state]}</span>
        {r.overdue && <span className="badge badge-overdue">Atrasado</span>}
      </td>
      <td data-col="dueDate" data-label="Prazo">{r.project.dueDate ? formatDueDate(r.project.dueDate) : '—'}</td>
      <td data-col="activities" data-label="Atividades" className="num">{r.activities}</td>
      <td data-col="meters" data-label="Metros de cabo" className="num">{formatMeters(r.meters)}</td>
    </>
  );
}

/** Secao "Projetos" do painel: tudo o que o administrador designou, com o andamento e o que ja foi feito (so leitura). */
export default function ProjectsTableSection() {
  const data = useLiveQuery(async () => ({
    projects: await db.projects.toArray(),
    activities: await db.activities.toArray(),
    elements: await db.elements.toArray(),
    cables: await db.cables.toArray(),
  }));
  const filters = usePanelProjects((s) => s.filters);
  const sort = usePanelProjects((s) => s.sort);
  const visible = usePanelProjects((s) => s.visible);
  const selectedId = usePanelProjects((s) => s.selectedId);

  const assigneeIds = useMemo(() => [...new Set((data?.projects ?? []).map((p) => p.assignedTo))], [data]);
  const names = usePeopleNames(assigneeIds, data?.activities ?? []);
  const rows = useMemo(() => (data ? buildProjectTableRows(data, names, Date.now()) : null), [data, names]);
  const counts = useMemo(() => countByState(rows ?? []), [rows]);
  const technicians = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows ?? []) seen.set(r.project.assignedTo, r.technicianName);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [rows]);
  const filtered = useMemo(() => (rows ? sortProjectRows(filterProjectRows(rows, filters), sort) : null), [rows, filters, sort]);
  if (!data || !rows || !filtered) return <p className="hint panel-loading">Carregando…</p>;

  const totals = projectTotalsOf(filtered);
  const n = activeProjectFilterCount(filters);
  const selected = selectedId ? rows.find((r) => r.id === selectedId) : undefined;
  const shown = filtered.slice(0, visible);

  function exportCsv() {
    downloadFile(new File([projectsCsv(filtered!)], projectsFileName(new Date()), { type: 'text/csv;charset=utf-8' }));
  }

  return (
    <div className="panel-table-layout">
      <aside className="panel-filterbar" aria-label="Filtros dos projetos">
        <div className="field">
          <label htmlFor="pp-query">Buscar</label>
          <input id="pp-query" type="text" autoComplete="off" placeholder="Projeto, OS, endereço, técnico…" value={filters.query} onChange={(e) => panelProjectsStore.setFilters({ query: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pp-state">Situação</label>
          <select id="pp-state" value={filters.state} onChange={(e) => panelProjectsStore.setFilters({ state: e.target.value as StateFilter })}>
            {STATE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label} ({counts[f.value]})</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pp-tech">Técnico</label>
          <select id="pp-tech" value={filters.technician} onChange={(e) => panelProjectsStore.setFilters({ technician: e.target.value })}>
            <option value="">Todos</option>
            {technicians.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
        <label className="panel-checkbox">
          <input type="checkbox" checked={filters.onlyOverdue} onChange={(e) => panelProjectsStore.setFilters({ onlyOverdue: e.target.checked })} />
          Só os atrasados
        </label>
        <section className="card panel-counts" role="status" aria-label="O que está na tabela">
          <div>
            <strong>{totals.projects}</strong> de {rows.length} projetos
          </div>
          <div>
            {totals.activities} atividades · {totals.elements} elementos · {totals.cables} cabos · {formatMeters(totals.meters)}
          </div>
          <button className="btn" disabled={filtered.length === 0} onClick={exportCsv}>
            Exportar CSV
          </button>
          <button className="btn" disabled={n === 0} onClick={panelProjectsStore.resetFilters}>
            Limpar filtros{n > 0 ? ` (${n})` : ''}
          </button>
        </section>
      </aside>

      <div className="panel-table-body">
        <section className="panel-table-main" aria-label="Projetos">
          {filtered.length === 0 ? (
            <p className="hint panel-loading">
              {rows.length === 0 ? 'Ainda não há projetos neste navegador. O administrador cria os projetos; sincronize para trazê-los.' : 'Nenhum projeto com estes filtros.'}
            </p>
          ) : (
            <>
              <table className={`panel-table panel-table-projects${selectedId ? ' panel-table-compact' : ''}`}>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} data-col={c.key} scope="col" className={c.numeric ? 'num' : undefined} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button className="panel-th-btn" onClick={() => panelProjectsStore.toggleSort(c.key)} aria-label={`Ordenar por ${c.label}`}>
                          {c.label}
                          <span aria-hidden="true">{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} aria-selected={r.id === selectedId} onClick={() => panelProjectsStore.select(r.id)}>
                      <Cells r={r} />
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td data-label="Total" colSpan={5}>
                      <strong>Total do que está na tabela ({totals.projects})</strong>
                    </td>
                    <td data-col="activities" data-label="Atividades" className="num"><strong>{totals.activities}</strong></td>
                    <td data-col="meters" data-label="Metros de cabo" className="num"><strong>{formatMeters(totals.meters)}</strong></td>
                  </tr>
                </tfoot>
              </table>
              {filtered.length > shown.length && (
                <button className="btn btn-block panel-more" onClick={panelProjectsStore.showMore}>
                  Mostrar mais ({shown.length} de {filtered.length})
                </button>
              )}
            </>
          )}
        </section>

        {selectedId && (
          <aside className="panel-detail" aria-label="Ficha do projeto">
            <div className="panel-detail-bar">
              <span />
              <button className="btn btn-small" onClick={() => panelProjectsStore.select(null)} aria-label="Fechar ficha">
                Fechar
              </button>
            </div>
            {selected ? <ProjectInfo key={selected.id} row={selected} activities={data.activities} /> : <div className="alert" role="alert">Este projeto não existe mais (foi excluído ou passou para outra pessoa).</div>}
          </aside>
        )}
      </div>
    </div>
  );
}
