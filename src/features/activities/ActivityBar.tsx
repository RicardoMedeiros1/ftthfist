import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../../lib/route';
import { activities } from './activityRepo';
import { KIND_LABEL } from './labels';

/** Faixa no topo do mapa: mostra a atividade aberta e dá acesso à lista e às configurações. */
export default function ActivityBar() {
  // undefined = carregando; null = nenhuma aberta
  const open = useLiveQuery(() => activities.getOpen());

  return (
    <div className="activity-bar">
      <button
        className={`activity-main ${open ? 'activity-main-open' : ''}`}
        onClick={() => navigate(open ? 'atividades' : 'nova-atividade')}
        aria-label={open ? `Atividade aberta: ${open.title}. Abrir lista de atividades` : 'Iniciar uma atividade'}
      >
        {open ? (
          <>
            <span className="activity-title">{open.title}</span>
            <span className="activity-sub">
              ● {KIND_LABEL[open.kind]}
              {open.osNumber ? ` · OS ${open.osNumber}` : ''}
            </span>
          </>
        ) : (
          <>
            <span className="activity-title">{open === undefined ? ' ' : 'Nenhuma atividade aberta'}</span>
            <span className="activity-sub">{open === undefined ? ' ' : 'Toque para iniciar'}</span>
          </>
        )}
      </button>
      <button className="map-btn" onClick={() => navigate('config')} aria-label="Configurações">
        ⚙
      </button>
    </div>
  );
}
