import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../../db/db';
import { formatMeters } from '../../lib/geo';
import { downloadFile } from '../../lib/share';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { ELEMENT_TYPES } from '../elements/meta';
import { syncStore, useSync } from '../sync/syncRuntime';
import ActivityFilterFields from './ActivityFilterFields';
import { technicianOptions } from './mapFilters';
import { panelTotalsStore, usePanelTotalsFilters } from './panelTotalsStore';
import { compareWithServer, periodBounds, totalsErrorText, type TotalsDiff } from './serverTotals';
import { totalsApi } from './panelRuntime';
import { activeTotalsFilterCount, computeTotals, sumTotals, totalsCsv, totalsFileName } from './totals';

type Check = { state: 'ocioso' } | { state: 'conferindo' } | { state: 'igual'; at: number } | { state: 'diferente'; diffs: TotalsDiff[] } | { state: 'erro'; message: string };

/** Secao "Totais": cabos, metros e elementos por tecnico e periodo; exporta CSV e confere com o servidor. */
export default function TotalsSection() {
  const data = useLiveQuery(async () => ({
    activities: await db.activities.toArray(),
    elements: await db.elements.toArray(),
    cables: await db.cables.toArray(),
  }));
  const filters = usePanelTotalsFilters();
  const online = useOnlineStatus();
  const syncing = useSync((s) => s.phase === 'sincronizando');
  const [check, setCheck] = useState<Check>({ state: 'ocioso' });
  const owners = useMemo(() => technicianOptions(data?.activities ?? []), [data]);
  const rows = useMemo(() => (data ? computeTotals(data, filters) : null), [data, filters]);
  if (!data || !rows) return <p className="hint panel-loading">Carregando…</p>;

  const total = sumTotals(rows);
  const n = activeTotalsFilterCount(filters);
  // a conferencia compara a rede inteira no periodo: com tecnico ou tipo filtrado nao ha com o que comparar
  const canCheck = totalsApi !== null && online && filters.owner === 'todos' && filters.kind === 'todas';

  async function conferir() {
    if (!totalsApi || !data) return;
    setCheck({ state: 'conferindo' });
    try {
      const b = periodBounds(filters);
      const remote = await totalsApi.cableTotals(b.from, b.to);
      const here = computeTotals(data, filters);
      const r = compareWithServer(here, remote);
      setCheck(r.equal ? { state: 'igual', at: Date.now() } : { state: 'diferente', diffs: r.diffs });
    } catch (e) {
      setCheck({ state: 'erro', message: totalsErrorText(e) });
    }
  }

  function exportCsv() {
    const file = new File([totalsCsv(rows!)], totalsFileName(filters, new Date()), { type: 'text/csv;charset=utf-8' });
    downloadFile(file);
  }

  return (
    <div className="panel-table-layout">
      <aside className="panel-filterbar" aria-label="Filtros dos totais">
        <ActivityFilterFields
          prefix="tt"
          value={{ ...filters, status: 'todas' }}
          owners={owners}
          onChange={(patch) => {
            const { status: _ignored, ...rest } = patch;
            panelTotalsStore.setFilters(rest);
            setCheck({ state: 'ocioso' });
          }}
          hideStatus
          periodLabel="Período (data em que o cabo ou o elemento foi registrado)"
        />
        <section className="card panel-counts" aria-label="Ações">
          <button className="btn" disabled={rows.length === 0} onClick={exportCsv}>
            Exportar CSV
          </button>
          <button className="btn" disabled={n === 0} onClick={() => { panelTotalsStore.resetFilters(); setCheck({ state: 'ocioso' }); }}>
            Limpar filtros{n > 0 ? ` (${n})` : ''}
          </button>
        </section>
      </aside>

      <section className="panel-table-main" aria-label="Totais por técnico">
        {rows.length === 0 ? (
          <p className="hint panel-loading">{data.cables.length + data.elements.length + data.activities.length === 0 ? 'Ainda não há dados neste navegador. Sincronize para trazer o trabalho dos técnicos.' : 'Nada neste período e com estes filtros.'}</p>
        ) : (
          <table className="panel-table panel-totals-table">
            <thead>
              <tr>
                <th scope="col">Técnico</th>
                <th scope="col" className="num">Atividades</th>
                <th scope="col" className="num">Cabos</th>
                <th scope="col" className="num">Traçado</th>
                <th scope="col" className="num">Reservas</th>
                <th scope="col" className="num">Total de cabo</th>
                <th scope="col" className="num">Elementos</th>
                {ELEMENT_TYPES.map((t) => (
                  <th key={t.type} scope="col" className="num">{t.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.owner}>
                  <td data-label="Técnico"><strong>{r.label}</strong></td>
                  <td data-label="Atividades" className="num">{r.activities}</td>
                  <td data-label="Cabos" className="num">{r.cables}</td>
                  <td data-label="Traçado" className="num">{formatMeters(r.lengthMeters)}</td>
                  <td data-label="Reservas" className="num">{formatMeters(r.reserveMeters)}</td>
                  <td data-label="Total de cabo" className="num"><strong>{formatMeters(r.totalMeters)}</strong></td>
                  <td data-label="Elementos" className="num">{r.elements}</td>
                  {ELEMENT_TYPES.map((t) => (
                    <td key={t.type} data-label={t.label} className="num">{r.byType[t.type]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td data-label="Técnico"><strong>Total</strong></td>
                <td data-label="Atividades" className="num"><strong>{total.activities}</strong></td>
                <td data-label="Cabos" className="num"><strong>{total.cables}</strong></td>
                <td data-label="Traçado" className="num"><strong>{formatMeters(total.lengthMeters)}</strong></td>
                <td data-label="Reservas" className="num"><strong>{formatMeters(total.reserveMeters)}</strong></td>
                <td data-label="Total de cabo" className="num"><strong>{formatMeters(total.totalMeters)}</strong></td>
                <td data-label="Elementos" className="num"><strong>{total.elements}</strong></td>
                {ELEMENT_TYPES.map((t) => (
                  <td key={t.type} data-label={t.label} className="num"><strong>{total.byType[t.type]}</strong></td>
                ))}
              </tr>
            </tfoot>
          </table>
        )}

        <p className="hint">Total de cabo = traçado + reservas, os mesmos números que o técnico viu no app. Exclui o que foi apagado.</p>

        {totalsApi && (
          <section className="card panel-check" aria-label="Conferência com o servidor">
            <div className="card-title">Conferir com o servidor</div>
            <div className="card-meta">Soma os cabos no servidor e compara com esta tabela. Se não bater, este navegador ainda não recebeu tudo.</div>
            <button className="btn" disabled={!canCheck || check.state === 'conferindo'} onClick={() => void conferir()}>
              {check.state === 'conferindo' ? 'Conferindo…' : 'Conferir agora'}
            </button>
            {!online && <p className="hint">Sem internet: a conferência precisa do servidor.</p>}
            {online && (filters.owner !== 'todos' || filters.kind !== 'todas') && <p className="hint">Tire o filtro de técnico e de tipo para conferir: o servidor soma a rede inteira no período.</p>}
            {check.state === 'igual' && <div className="ok-note" role="status">Confere com o servidor: os totais de cabo são os mesmos.</div>}
            {check.state === 'erro' && <div className="alert" role="alert">{check.message}</div>}
            {check.state === 'diferente' && (
              <div className="alert" role="alert">
                <strong>Não confere com o servidor.</strong> Provavelmente falta sincronizar.
                <ul className="panel-diffs">
                  {check.diffs.map((d) => (
                    <li key={d.owner}>
                      {d.label || 'Técnico'}:{' '}
                      {d.status === 'so-servidor' ? `o servidor tem ${d.server.cables} cabos (${formatMeters(d.server.totalMeters)}) e aqui não há nenhum` : d.status === 'so-aqui' ? `aqui há ${d.here.cables} cabos (${formatMeters(d.here.totalMeters)}) e o servidor não tem nenhum` : `servidor ${d.server.cables} cabos (${formatMeters(d.server.totalMeters)}) · aqui ${d.here.cables} cabos (${formatMeters(d.here.totalMeters)})`}
                    </li>
                  ))}
                </ul>
                <button className="btn" disabled={!online || syncing} onClick={() => void syncStore.syncNow()}>
                  {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
                </button>
              </div>
            )}
          </section>
        )}
      </section>
    </div>
  );
}
