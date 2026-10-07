import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../../db/db';
import { formatDateTime, formatDuration } from '../../lib/format';
import { formatMeters } from '../../lib/geo';
import { navigate } from '../../lib/route';
import { KIND_LABEL } from '../activities/labels';
import ActivityFilterFields from './ActivityFilterFields';
import ActivityInfo from './ActivityInfo';
import { activeRowFilterCount, buildRows, filterRows, sortRows, totalsOf, type ActivityRow, type SortKey } from './activityRows';
import { technicianOptions } from './mapFilters';
import { panelMapStore } from './panelMapStore';
import { panelTableStore, usePanelTable } from './panelTableStore';

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'title', label: 'Atividade' },
  { key: 'technician', label: 'Técnico' },
  { key: 'kind', label: 'Tipo' },
  { key: 'status', label: 'Situação' },
  { key: 'startedAt', label: 'Início' },
  { key: 'durationMs', label: 'Duração', numeric: true },
  { key: 'elements', label: 'Elementos', numeric: true },
  { key: 'cables', label: 'Cabos', numeric: true },
  { key: 'meters', label: 'Metros de cabo', numeric: true },
  { key: 'photos', label: 'Fotos', numeric: true },
];

function Cells({ r }: { r: ActivityRow }) {
  return (
    <>
      <td data-col="title" data-label="Atividade">
        <button className="panel-row-btn" onClick={() => panelTableStore.select(r.id)}>
          <strong>{r.title}</strong>
          {r.osNumber && <small>OS {r.osNumber}</small>}
        </button>
      </td>
      <td data-col="technician" data-label="Técnico">{r.technician}</td>
      <td data-col="kind" data-label="Tipo">{KIND_LABEL[r.kind]}</td>
      <td data-col="status" data-label="Situação">{r.status === 'aberta' ? 'Em aberto' : 'Concluída'}</td>
      <td data-col="startedAt" data-label="Início">{formatDateTime(r.startedAt)}</td>
      <td data-col="durationMs" data-label="Duração" className="num">{r.durationMs !== null ? formatDuration(r.durationMs) : r.status === 'aberta' ? 'em andamento' : '—'}</td>
      <td data-col="elements" data-label="Elementos" className="num">{r.elements}</td>
      <td data-col="cables" data-label="Cabos" className="num">{r.cables}</td>
      <td data-col="meters" data-label="Metros de cabo" className="num">{formatMeters(r.meters)}</td>
      <td data-col="photos" data-label="Fotos" className="num">{r.photos}</td>
    </>
  );
}

/** Secao "Atividades" do painel: tabela de todas as atividades (filtros, busca, ordem) e a ficha da escolhida ao lado. */
export default function ActivitiesTableSection() {
  const data = useLiveQuery(async () => ({
    activities: await db.activities.toArray(),
    elements: await db.elements.toArray(),
    cables: await db.cables.toArray(),
    photos: await db.photos.toArray(),
  }));
  const filters = usePanelTable((s) => s.filters);
  const sort = usePanelTable((s) => s.sort);
  const visible = usePanelTable((s) => s.visible);
  const selectedId = usePanelTable((s) => s.selectedId);

  const rows = useMemo(() => (data ? buildRows(data) : null), [data]);
  const owners = useMemo(() => technicianOptions(data?.activities ?? []), [data]);
  const filtered = useMemo(() => (rows ? sortRows(filterRows(rows, filters), sort) : null), [rows, filters, sort]);
  if (!data || !rows || !filtered) return <p className="hint panel-loading">Carregando…</p>;

  const totals = totalsOf(filtered);
  const n = activeRowFilterCount(filters);
  const selected = selectedId ? data.activities.find((a) => a.id === selectedId && !a.deleted) : undefined;
  const shown = filtered.slice(0, visible);

  return (
    <div className="panel-table-layout">
      <aside className="panel-filterbar" aria-label="Filtros da tabela">
        <div className="field">
          <label htmlFor="pt-query">Buscar</label>
          <input
            id="pt-query"
            type="text"
            autoComplete="off"
            placeholder="Título, OS, técnico ou código"
            value={filters.query}
            onChange={(e) => panelTableStore.setFilters({ query: e.target.value })}
          />
        </div>
        <ActivityFilterFields prefix="pt" value={filters} owners={owners} onChange={panelTableStore.setFilters} />
        <section className="card panel-counts" role="status" aria-label="O que está na tabela">
          <div>
            <strong>{totals.activities}</strong> de {rows.length} atividades
          </div>
          <div>
            {totals.elements} elementos · {totals.cables} cabos · {formatMeters(totals.meters)} · {totals.photos} fotos
          </div>
          <button className="btn" disabled={n === 0} onClick={panelTableStore.resetFilters}>
            Limpar filtros{n > 0 ? ` (${n})` : ''}
          </button>
        </section>
      </aside>

      <div className="panel-table-body">
      <section className="panel-table-main" aria-label="Atividades">
        {filtered.length === 0 ? (
          <p className="hint panel-loading">{rows.length === 0 ? 'Ainda não há atividades neste navegador. Sincronize para trazer o trabalho dos técnicos.' : 'Nenhuma atividade com estes filtros.'}</p>
        ) : (
          <>
            <table className={`panel-table${selectedId ? ' panel-table-compact' : ''}`}>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} data-col={c.key} scope="col" className={c.numeric ? 'num' : undefined} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button className="panel-th-btn" onClick={() => panelTableStore.toggleSort(c.key)} aria-label={`Ordenar por ${c.label}`}>
                        {c.label}
                        <span aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} aria-selected={r.id === selectedId} onClick={() => panelTableStore.select(r.id)}>
                    <Cells r={r} />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td data-label="Total" colSpan={6}>
                    <strong>Total do que está na tabela ({totals.activities})</strong>
                  </td>
                  <td data-col="elements" data-label="Elementos" className="num"><strong>{totals.elements}</strong></td>
                  <td data-col="cables" data-label="Cabos" className="num"><strong>{totals.cables}</strong></td>
                  <td data-col="meters" data-label="Metros de cabo" className="num"><strong>{formatMeters(totals.meters)}</strong></td>
                  <td data-col="photos" data-label="Fotos" className="num"><strong>{totals.photos}</strong></td>
                </tr>
              </tfoot>
            </table>
            {filtered.length > shown.length && (
              <button className="btn btn-block panel-more" onClick={panelTableStore.showMore}>
                Mostrar mais ({shown.length} de {filtered.length})
              </button>
            )}
          </>
        )}
      </section>

      {selectedId && (
        <aside className="panel-detail" aria-label="Ficha da atividade">
          <div className="panel-detail-bar">
            <span />
            <button className="btn btn-small" onClick={() => panelTableStore.select(null)} aria-label="Fechar ficha">
              Fechar
            </button>
          </div>
          {selected ? (
            <ActivityInfo
              key={selected.id}
              activity={selected}
              elements={data.elements}
              cables={data.cables}
              onDeleted={() => panelTableStore.select(null)}
              onShowOnMap={() => {
                panelMapStore.focus({ kind: 'atividade', id: selected.id });
                navigate('painel', { id: 'mapa' });
              }}
            />
          ) : (
            <div className="alert" role="alert">Esta atividade não existe mais (foi excluída ou ainda não chegou).</div>
          )}
        </aside>
      )}
      </div>
    </div>
  );
}
