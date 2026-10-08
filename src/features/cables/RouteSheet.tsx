import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { formatMeters } from '../../lib/geo';
import { navigate } from '../../lib/route';
import { cableStore } from './cableRepo';
import RouteSummaryView from './RouteSummaryView';
import { routeStore, useSelectedRoute } from './routeStore';
import { summarizeRoute } from './routeSummary';

/** Folha de baixo do mapa com a rota do cabo tocado: quantos cabos, metros, CTOs e a fibra de cada uma. */
export default function RouteSheet() {
  const selected = useSelectedRoute();
  const cables = useLiveQuery(() => cableStore.list());
  const elements = useLiveQuery(() => db.elements.filter((e) => !e.deleted).toArray());
  if (!selected || !cables || !elements) return null;
  const s = summarizeRoute(selected, cables, elements);
  if (s.cables.length === 0) return null;
  // abrir uma ficha encerra a rota: ao voltar, o mapa está livre (e o "+" de volta)
  const open = (route: 'cabo' | 'elemento', id: string) => {
    routeStore.clear();
    navigate(route, { id });
  };
  return (
    <div className="sheet route-sheet" role="dialog" aria-label="Rota do cabo">
      <div className="sheet-title">
        Rota: {s.cables.length} {s.cables.length === 1 ? 'cabo' : 'cabos'} · {formatMeters(s.meters)} · {s.ctos.length} {s.ctos.length === 1 ? 'CTO' : 'CTOs'}
      </div>
      <div className="route-scroll">
        <RouteSummaryView
          summary={s}
          current={selected}
          onCable={(id) => open('cabo', id)}
          onCto={(id) => open('elemento', id)}
        />
      </div>
      <div className="placement-row">
        <button className="btn" onClick={() => open('cabo', selected)}>Abrir este cabo</button>
        <button className="btn btn-primary" onClick={routeStore.clear}>Fechar</button>
      </div>
    </div>
  );
}
