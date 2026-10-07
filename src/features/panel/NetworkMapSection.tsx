import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../../db/db';
import MapDetail from './MapDetail';
import MapFiltersPanel from './MapFiltersPanel';
import { applyMapFilters, type MapData } from './mapFilters';
import NetworkMap from './NetworkMap';
import { panelMapStore, usePanelMap } from './panelMapStore';

/** Secao "Mapa da rede" do painel: filtros e busca a esquerda, mapa no meio, ficha do item a direita. */
export default function NetworkMapSection() {
  const data = useLiveQuery(async (): Promise<MapData> => ({
    activities: await db.activities.toArray(),
    elements: await db.elements.toArray(),
    cables: await db.cables.toArray(),
  }));
  const filters = usePanelMap((s) => s.filters);
  const selection = usePanelMap((s) => s.selection);
  const view = useMemo(() => (data ? applyMapFilters(data, filters) : null), [data, filters]);
  const fitKey = useMemo(() => JSON.stringify(filters), [filters]);

  if (!data || !view) return <p className="hint panel-loading">Carregando…</p>;
  const empty = view.totals.elements === 0 && view.totals.cables === 0;
  const nothing = !empty && view.elements.length === 0 && view.cables.length === 0;

  return (
    <div className="panel-map-layout">
      <MapFiltersPanel
        data={data}
        view={view}
        filters={filters}
        onChange={panelMapStore.setFilters}
        onReset={panelMapStore.resetFilters}
        onPick={panelMapStore.focus}
      />
      <div className="panel-map-center">
        <NetworkMap data={data} view={view} fitKey={fitKey} onSelect={panelMapStore.select} />
        {empty && (
          <div className="panel-map-empty" role="status">
            Ainda não há elementos nem cabos neste navegador. Sincronize para trazer o trabalho dos técnicos.
          </div>
        )}
        {nothing && (
          <div className="panel-map-empty" role="status">
            Nada com estes filtros.
          </div>
        )}
      </div>
      {selection && (
        <MapDetail
          selection={selection}
          data={data}
          onClose={() => panelMapStore.select(null)}
          onFocus={() => panelMapStore.focus(selection)}
        />
      )}
    </div>
  );
}
