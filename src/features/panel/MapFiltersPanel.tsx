import { useMemo } from 'react';
import { formatMeters } from '../../lib/geo';
import { ELEMENT_TYPES } from '../elements/meta';
import { LegendList } from '../cables/Legend';
import { FIBER_COUNTS } from '../cables/style';
import ActivityFilterFields from './ActivityFilterFields';
import { DEFAULT_MAP_FILTERS, activeMapFilterCount, searchHits, technicianOptions, type MapData, type MapFilters, type MapView } from './mapFilters';
import type { Selection } from './panelMapStore';

/** Coluna da esquerda do mapa: busca, resultados, filtros e legenda. Nao guarda estado: tudo vem do `panelMapStore`. */
export default function MapFiltersPanel({
  data,
  view,
  filters,
  onChange,
  onReset,
  onPick,
}: {
  data: MapData;
  view: MapView;
  filters: MapFilters;
  onChange: (patch: Partial<MapFilters>) => void;
  onReset: () => void;
  onPick: (s: Selection) => void;
}) {
  const owners = useMemo(() => technicianOptions(data.activities), [data.activities]);
  const found = useMemo(() => searchHits(view, filters.query), [view, filters.query]);
  const n = activeMapFilterCount(filters);
  const meters = view.cables.reduce((s, c) => s + c.totalMeters, 0);
  const toggleType = (t: (typeof ELEMENT_TYPES)[number]['type']) =>
    onChange({ types: filters.types.includes(t) ? filters.types.filter((x) => x !== t) : [...filters.types, t] });

  return (
    <aside className="panel-filters" aria-label="Filtros do mapa">
      <div className="field">
        <label htmlFor="pm-query">Buscar</label>
        <input
          id="pm-query"
          type="text"
          autoComplete="off"
          placeholder="Código, OS, atividade ou técnico"
          value={filters.query}
          onChange={(e) => onChange({ query: e.target.value })}
        />
      </div>

      {filters.query.trim() !== '' && (
        <section aria-label="Resultados da busca" className="panel-hits">
          {found.total === 0 ? (
            <p className="hint">Nada encontrado com os filtros atuais.</p>
          ) : (
            <>
              <ul>
                {found.hits.map((h) => (
                  <li key={`${h.kind}:${h.id}`}>
                    <button className="btn" onClick={() => onPick({ kind: h.kind === 'atividade' ? 'atividade' : h.kind === 'cabo' ? 'cabo' : 'elemento', id: h.id })}>
                      <strong>{h.title}</strong>
                      <small>{h.kind === 'atividade' ? 'Atividade' : h.kind === 'cabo' ? 'Cabo' : 'Elemento'} · {h.subtitle}</small>
                    </button>
                  </li>
                ))}
              </ul>
              {found.total > found.hits.length && <p className="hint">Mostrando {found.hits.length} de {found.total}. Refine a busca.</p>}
            </>
          )}
        </section>
      )}

      <ActivityFilterFields prefix="pm" value={filters} owners={owners} onChange={onChange} />

      <div className="field">
        <span className="label">Mostrar</span>
        <div className="chips" role="group" aria-label="O que mostrar">
          <button type="button" aria-pressed={filters.showElements} onClick={() => onChange({ showElements: !filters.showElements })}>Elementos</button>
          <button type="button" aria-pressed={filters.showCables} onClick={() => onChange({ showCables: !filters.showCables })}>Cabos</button>
        </div>
      </div>

      {filters.showElements && (
        <div className="field">
          <span className="label">Tipos de elemento {filters.types.length === 0 && <small>(todos)</small>}</span>
          <div className="chips" role="group" aria-label="Tipos de elemento">
            {ELEMENT_TYPES.map((t) => (
              <button key={t.type} type="button" aria-pressed={filters.types.includes(t.type)} onClick={() => toggleType(t.type)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {filters.showCables && (
        <div className="field">
          <label htmlFor="pm-fibers">Nº de fibras do cabo</label>
          <select id="pm-fibers" value={String(filters.fibers)} onChange={(e) => onChange({ fibers: e.target.value === 'todas' ? 'todas' : Number(e.target.value) })}>
            <option value="todas">Todas</option>
            {FIBER_COUNTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      )}

      <section className="card panel-counts" role="status" aria-label="O que está na tela">
        <div>
          <strong>{view.elements.length}</strong> de {view.totals.elements} elementos
        </div>
        <div>
          <strong>{view.cables.length}</strong> de {view.totals.cables} cabos · {formatMeters(meters)}
        </div>
        <div>
          <strong>{view.activities.length}</strong> de {view.totals.activities} atividades
        </div>
        <button className="btn" disabled={n === 0 && JSON.stringify(filters) === JSON.stringify(DEFAULT_MAP_FILTERS)} onClick={onReset}>
          Limpar filtros{n > 0 ? ` (${n})` : ''}
        </button>
      </section>

      <details className="panel-legend">
        <summary>Legenda dos cabos</summary>
        <LegendList />
      </details>
    </aside>
  );
}
