import { formatMeters } from '../../lib/geo';
import { FiberSwatch } from './FiberList';
import { FiberLine } from './Legend';
import type { RouteSummary } from './routeSummary';
import './fibers.css';

/**
 * O resumo da rota (cabos e CTOs com a fibra de cada uma): o mesmo no mapa do técnico e na ficha do painel.
 * `current` é o cabo tocado; `onCable` e `onCto` abrem o cabo ou a CTO (a tela decide o que "abrir" significa).
 */
export default function RouteSummaryView({
  summary,
  current,
  onCable,
  onCto,
}: {
  summary: RouteSummary;
  current?: string;
  onCable?: (id: string) => void;
  onCto?: (id: string) => void;
}) {
  return (
    <div className="route-view">
      <span className="label">Cabos da rota ({summary.cables.length})</span>
      <ul className="route-list">
        {summary.cables.map((c) => {
          const used = summary.fibersInUse.get(c.id) ?? 0;
          const body = (
            <>
              <FiberLine fiberCount={c.fiberCount} width={44} />
              <span className="route-text">
                <strong>{c.cableType} · {c.fiberCount} fibras{c.id === current ? ' (o que você tocou)' : ''}</strong>
                <small>{formatMeters(c.totalMeters)}{used > 0 ? ` · ${used} ${used === 1 ? 'fibra em uso' : 'fibras em uso'}` : ''}</small>
              </span>
            </>
          );
          return (
            <li key={c.id}>
              {onCable ? <button type="button" className="route-row" onClick={() => onCable(c.id)}>{body}</button> : <div className="route-row">{body}</div>}
            </li>
          );
        })}
      </ul>
      <span className="label">CTOs da rota ({summary.ctos.length})</span>
      {summary.ctos.length === 0 ? (
        <p className="hint">Nenhuma CTO ligada a estes cabos ainda.</p>
      ) : (
        <ul className="route-list">
          {summary.ctos.map(({ element, feed }) => {
            const body = (
              <>
                {feed?.fiber ? <FiberSwatch color={feed.fiber.color} size={26} /> : <span className="route-nofiber" aria-hidden="true">?</span>}
                <span className="route-text">
                  <strong>{element.code ? `CTO ${element.code}` : 'CTO sem código'}</strong>
                  <small>{feed ? feed.text : 'fibra de entrada não informada'}</small>
                </span>
              </>
            );
            return (
              <li key={element.id}>
                {onCto ? <button type="button" className="route-row" onClick={() => onCto(element.id)}>{body}</button> : <div className="route-row">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
