import { navigate } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { pillView } from './pillText';
import { useSync } from './syncRuntime';

/** Indicador do mapa: Online/Offline e, com conta ativa, o que esta pendente. Tocar abre a tela de sincronizacao. */
export default function SyncPill() {
  const online = useOnlineStatus();
  const phase = useSync((s) => s.phase);
  const pending = useSync((s) => s.pending);
  const blocked = useSync((s) => s.blocked);
  const progress = useSync((s) => s.progress);
  const firstSync = useSync((s) => s.firstSync);
  const view = pillView({ phase, pending, blocked, progress, firstSync }, online);
  const cls = `net-pill ${online ? 'net-online' : 'net-offline'}${view.tone === 'atencao' ? ' net-attention' : ''}`;
  const dot = <span className="net-dot" aria-hidden="true" />;

  if (phase === 'desligado') {
    return (
      <div className={cls} role="status">
        {dot}
        {view.text}
      </div>
    );
  }
  return (
    <button className={`${cls} net-pill-btn`} onClick={() => navigate('sincronizacao')} aria-label={`Sincronização: ${view.text}. Toque para abrir.`}>
      {dot}
      {view.text}
    </button>
  );
}
