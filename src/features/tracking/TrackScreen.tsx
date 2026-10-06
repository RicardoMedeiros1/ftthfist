import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ConfirmDialog from '../../components/ConfirmDialog';
import ScreenShell from '../../components/ScreenShell';
import { formatClock, formatKm } from '../../lib/format';
import { formatAccuracy } from '../../lib/geo';
import { goBack, navigate } from '../../lib/route';
import { useNow } from '../../lib/useNow';
import { activities } from '../activities/activityRepo';
import { elapsedMs, trackRecorder, useTrack } from './trackRecorder';
import { trackStore } from './trackRepo';
import { trackDistanceMeters } from './trackStats';

/** Gravar a trilha GPS da atividade aberta: iniciar, pausar, retomar e encerrar. */
export default function TrackScreen() {
  const open = useLiveQuery(() => activities.getOpen()); // undefined = carregando, null = nenhuma
  const status = useTrack((s) => s.status);
  const recActivity = useTrack((s) => s.activityId);
  const message = useTrack((s) => s.message);
  const wake = useTrack((s) => s.wakeLock);
  const accuracy = useTrack((s) => s.lastAccuracy);
  const suspended = useTrack((s) => s.suspended);
  const state = useTrack((s) => s);
  const now = useNow(status === 'gravando');
  const [confirmClear, setConfirmClear] = useState(false);

  // Estatísticas da trilha da atividade aberta (do banco: valem também depois de encerrar).
  const stats = useLiveQuery(async () => {
    const o = await activities.getOpen();
    if (!o) return { points: 0, distanceM: 0 };
    const pts = await trackStore.listFor(o.id);
    return { points: pts.length, distanceM: trackDistanceMeters(pts) };
  });

  const recording = status === 'gravando';
  const paused = status === 'pausada';
  const idle = status === 'parada';
  const hasOpen = open !== undefined && open !== null;
  const foreign = !idle && recActivity !== null && open?.id !== recActivity; // gravação de outra atividade (não deveria acontecer)

  return (
    <ScreenShell title="Trilha GPS" onBack={() => goBack('map')}>
      {open === null && (
        <>
          <div className="alert" role="alert">Para gravar a trilha, primeiro inicie uma atividade.</div>
          <button className="btn btn-primary btn-block" onClick={() => navigate('nova-atividade', { replace: true })}>
            Iniciar atividade
          </button>
        </>
      )}

      {hasOpen && (
        <>
          <p className="hint">
            A trilha registra por onde você andou na atividade <strong>{open.title}</strong>. É só um registro de deslocamento:
            ela <strong>nunca vira cabo</strong>. O cabo é lançado poste a poste.
          </p>

          <div className="alert track-warning" role="note">
            <strong>Atenção:</strong> a gravação <strong>para se a tela apagar ou o app for fechado</strong> (limitação do navegador).
            Mantenha o app aberto e a tela ligada.
            <div className="track-wake">
              {recording || paused
                ? wake === 'ativo'
                  ? 'O app está mantendo a tela ligada.'
                  : wake === 'indisponivel'
                    ? 'Este navegador não consegue manter a tela ligada: mantenha-a ligada por conta própria.'
                    : ''
                : 'Ao iniciar, o app tenta manter a tela ligada.'}
            </div>
          </div>

          {message && (
            <div className="ok-note track-message" role="status">
              {message}
              <button className="btn btn-small" onClick={trackRecorder.dismissMessage}>OK</button>
            </div>
          )}

          {!idle && (
            <div className="track-stats" role="status" aria-label="Gravação">
              <div>
                <span className="track-label">{recording ? (suspended ? 'Parada (tela apagada)' : 'Gravando') : 'Pausada'}</span>
                <span className="track-big">{formatClock(elapsedMs(state, now))}</span>
              </div>
              <div>
                <span className="track-label">Distância</span>
                <span className="track-big">{formatKm(stats?.distanceM ?? 0)}</span>
              </div>
              <div>
                <span className="track-label">GPS</span>
                <span className="track-big">{accuracy !== null ? formatAccuracy(accuracy) : '—'}</span>
              </div>
            </div>
          )}

          {idle && stats && stats.points > 0 && (
            <div className="card">
              <div className="card-title">Trilha desta atividade</div>
              <div className="card-meta">{formatKm(stats.distanceM)} · {stats.points} pontos</div>
            </div>
          )}

          {foreign && <div className="alert" role="alert">Há uma gravação de outra atividade. Encerre-a para continuar.</div>}

          {idle && (
            <button className="btn btn-primary btn-block" onClick={() => void trackRecorder.start(open.id)}>
              {stats && stats.points > 0 ? 'Gravar mais (novo trecho)' : 'Iniciar gravação'}
            </button>
          )}
          {recording && (
            <div className="placement-row">
              <button className="btn" onClick={() => void trackRecorder.pause()}>Pausar</button>
              <button className="btn btn-danger" onClick={() => void trackRecorder.stop()}>Encerrar</button>
            </div>
          )}
          {paused && (
            <>
              <button className="btn btn-primary btn-block" onClick={() => void trackRecorder.resume()}>
                Retomar
              </button>
              <button className="btn btn-block" onClick={() => void trackRecorder.stop()}>
                Encerrar
              </button>
            </>
          )}
          {idle && stats && stats.points > 0 && (
            <button className="btn btn-danger btn-block" onClick={() => setConfirmClear(true)}>
              Apagar a trilha desta atividade
            </button>
          )}
        </>
      )}

      {confirmClear && hasOpen && (
        <ConfirmDialog
          title="Apagar a trilha?"
          message={`Os ${stats?.points ?? 0} pontos da trilha desta atividade serão excluídos. Elementos e cabos não são afetados.`}
          confirmLabel="Apagar"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            void trackStore.clear(open.id).then(() => trackRecorder.refreshStats());
          }}
        />
      )}
    </ScreenShell>
  );
}
