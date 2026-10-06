import { formatMeters } from '../../lib/geo';
import { remoteTrackStore, useRemoteTrack } from './adminRuntime';
import './admin.css';

/** Faixa sobre o mapa enquanto uma trilha de outra pessoa estiver aberta: o que e, quanto mede e como esconder. */
export default function RemoteTrackBar() {
  const t = useRemoteTrack();
  if (t.status === 'oculta' || !t.activityId) return null;
  const line =
    t.status === 'baixando'
      ? `Baixando a trilha… ${t.loaded} pontos`
      : t.status === 'erro'
        ? (t.error ?? 'Não foi possível baixar a trilha.')
        : t.points.length === 0
          ? 'Nenhum ponto de trilha foi enviado para esta atividade.'
          : `${t.points.length} pontos · ${formatMeters(t.meters)}${t.truncated ? ' · só os primeiros pontos (trilha muito longa)' : ''}`;
  return (
    <div className="remote-track-bar" role="status">
      <div className="remote-track-text">
        <strong>Trilha GPS · {t.label}</strong>
        <span>{line}</span>
      </div>
      {t.status === 'erro' && (
        <button className="btn" onClick={() => void remoteTrackStore.show(t.activityId!, t.label)}>Tentar de novo</button>
      )}
      <button className="btn" onClick={() => remoteTrackStore.hide()}>Esconder trilha</button>
    </div>
  );
}
