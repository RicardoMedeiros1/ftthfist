import { useLiveQuery } from 'dexie-react-hooks';
import { formatMeters } from '../../lib/geo';
import { navigate } from '../../lib/route';
import { elementStore } from '../elements/elementRepo';
import { ELEMENT_META } from '../elements/meta';
import { cableStore } from './cableRepo';
import { connectionsOf, routeMeters, routeOf } from './routes';

/** Na ficha do cabo: com quais cabos ele está ligado (e onde) e o tamanho da rota toda. Some se o cabo não tem ligação. */
export default function CableConnections({ cableId }: { cableId: string }) {
  const all = useLiveQuery(() => cableStore.list());
  const labels = useLiveQuery(async () => {
    const ids = new Set((all ? connectionsOf(cableId, all) : []).map((c) => c.elementId));
    const found = await Promise.all([...ids].map((id) => elementStore.get(id)));
    return new Map(found.flatMap((e) => (e ? [[e.id, `${ELEMENT_META[e.type].label}${e.code ? ' ' + e.code : ''}`] as const] : [])));
  }, [all, cableId]);
  if (!all) return null;
  const links = connectionsOf(cableId, all);
  if (links.length === 0) return null;
  const route = routeOf(cableId, all);
  const byId = new Map(all.map((c) => [c.id, c] as const));
  return (
    <section className="field" aria-label="Ligações do cabo">
      <span className="label">Ligado a ({links.length})</span>
      <div className="link-list">
        {links.map((l) => {
          const other = byId.get(l.cableId);
          if (!other) return null;
          return (
            <button key={`${l.elementId}-${l.cableId}`} type="button" className="link-row" onClick={() => navigate('cabo', { id: other.id })}>
              <span className="link-text">
                <strong>{other.cableType} · {other.fiberCount} fibras</strong>
                <small>em {labels?.get(l.elementId) ?? 'elemento'} · {formatMeters(other.totalMeters)}</small>
              </span>
            </button>
          );
        })}
      </div>
      <p className="hint">Rota toda: {route.cableIds.length} cabos ligados · {formatMeters(routeMeters(route.cableIds, all))}</p>
    </section>
  );
}
