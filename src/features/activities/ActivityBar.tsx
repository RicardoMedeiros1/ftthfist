import { useLiveQuery } from 'dexie-react-hooks';
import { formatClock, formatKm } from '../../lib/format';
import { navigate } from '../../lib/route';
import { useNow } from '../../lib/useNow';
import { elapsedMs, useTrack } from '../tracking/trackRecorder';
import { trackStore } from '../tracking/trackRepo';
import { trackDistanceMeters } from '../tracking/trackStats';
import { activities } from './activityRepo';
import { KIND_LABEL } from './labels';

/** Faixa no topo do mapa: mostra a atividade aberta e dá acesso à lista e às configurações. */
export default function ActivityBar() {
  // undefined = carregando; null = nenhuma aberta
  const open = useLiveQuery(() => activities.getOpen());
  const status = useTrack((t) => t.status);
  const trackState = useTrack((t) => t);
  const now = useNow(status === 'gravando');
  const km = useLiveQuery(async () => {
    const o = await activities.getOpen();
    return o ? trackDistanceMeters(await trackStore.listFor(o.id)) : 0;
  });

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
              {status !== 'parada' ? (
                <>
                  {/* Gravando: tempo e distância primeiro; o tipo da atividade (secundário) é o que a reticência corta. */}
                  <span className={`rec-dot ${status === 'pausada' ? 'rec-dot-pause' : ''}`} aria-hidden="true" />
                  {status === 'pausada' ? 'Pausada ' : ''}
                  {formatClock(elapsedMs(trackState, now))} · {formatKm(km ?? 0)} · {KIND_LABEL[open.kind]}
                </>
              ) : (
                <>● {KIND_LABEL[open.kind]}</>
              )}
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
