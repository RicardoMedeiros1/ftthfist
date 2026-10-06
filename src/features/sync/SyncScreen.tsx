import { useLiveQuery } from 'dexie-react-hooks';
import ScreenShell from '../../components/ScreenShell';
import { db } from '../../db/db';
import { formatDateTime } from '../../lib/format';
import { goBack, navigate } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { useNow } from '../../lib/useNow';
import { accountStore, useAccount } from '../account/accountStore';
import { ELEMENT_META } from '../elements/meta';
import { explainRefusal } from './messages';
import { stateSentence } from './pillText';
import { syncEngine, syncStore, useSync } from './syncRuntime';
import { TABLE_LABEL, type SyncTable } from './tables';
import './sync.css';

async function labelOf(table: SyncTable, id: string): Promise<string> {
  if (table === 'activities') return `Atividade · ${(await db.activities.get(id))?.title ?? '—'}`;
  if (table === 'elements') {
    const e = await db.elements.get(id);
    return e ? `${ELEMENT_META[e.type].label}${e.code ? ` ${e.code}` : ''}` : 'Elemento';
  }
  if (table === 'photos') return 'Foto';
  if (table === 'cables') {
    const c = await db.cables.get(id);
    return c ? `Cabo ${c.cableType} · ${c.fiberCount} fibras` : 'Cabo';
  }
  return 'Ponto da trilha';
}

function BlockedList() {
  const status = useAccount((s) => s.status);
  const role = useAccount((s) => s.profile?.role);
  const items = useLiveQuery(async () => {
    const userId = accountStore.currentUserId();
    if (!syncEngine || !userId || !role || status !== 'ativo') return [];
    const list = await syncEngine.blockedList({ userId, role });
    return Promise.all(list.map(async (b) => ({ ...b, label: await labelOf(b.table, b.id) })));
  }, [status, role]);
  if (!items || items.length === 0) return null;
  return (
    <section className="card" aria-label="Registros recusados">
      <div className="card-title">Recusados pelo servidor ({items.length})</div>
      <p className="hint">Estes registros continuam salvos aqui no aparelho, mas o servidor não os aceitou. Corrigir o registro (editar) o libera para uma nova tentativa.</p>
      <ul className="sync-blocked">
        {items.map((b) => (
          <li key={`${b.table}:${b.id}`}>
            <strong>{b.label}</strong>
            <span>{explainRefusal(b.message)}</span>
            <details>
              <summary>Detalhe técnico</summary>
              <code>{TABLE_LABEL[b.table]}: {b.message}</code>
            </details>
          </li>
        ))}
      </ul>
      <button className="btn btn-block" onClick={() => void syncStore.retryBlocked()}>
        Tentar de novo os recusados
      </button>
    </section>
  );
}

export default function SyncScreen() {
  const online = useOnlineStatus();
  const accountStatus = useAccount((s) => s.status);
  const phase = useSync((s) => s.phase);
  const pending = useSync((s) => s.pending);
  const blocked = useSync((s) => s.blocked);
  const progress = useSync((s) => s.progress);
  const lastSyncAt = useSync((s) => s.lastSyncAt);
  const lastError = useSync((s) => s.lastError);
  const lostEdits = useSync((s) => s.lostEdits);
  const firstSync = useSync((s) => s.firstSync);
  const now = useNow(true, 30_000);
  const running = phase === 'sincronizando';

  return (
    <ScreenShell title="Sincronização" onBack={() => goBack('map')}>
      {phase === 'desligado' ? (
        <>
          <p className="hint">
            {accountStatus === 'sem-configuracao'
              ? 'Este aplicativo não está ligado a um servidor. Ele funciona normalmente, só neste aparelho.'
              : 'Para enviar seus dados e ver o trabalho dos colegas, entre na conta e aguarde a aprovação do administrador. Enquanto isso, tudo continua sendo salvo neste aparelho.'}
          </p>
          {accountStatus !== 'sem-configuracao' && (
            <button className="btn btn-primary btn-block" onClick={() => navigate('conta')}>
              Abrir conta
            </button>
          )}
        </>
      ) : (
        <>
          <section className="card" aria-label="Situação da sincronização">
            <span className={`badge-state sync-badge-${blocked > 0 || phase === 'erro' || phase === 'precisa-entrar' ? 'atencao' : running ? 'andamento' : pending > 0 || phase === 'sem-rede' ? 'espera' : 'ok'}`}>
              {stateSentence({ phase, pending, blocked, lastSyncAt }, now)}
            </span>
            {running && progress && (
              <div className="card-meta" role="status">
                {progress.phase === 'enviando' ? `Enviando… ${progress.done} enviado(s)` : `Baixando… ${progress.done} registro(s)`}
              </div>
            )}
            {lastSyncAt !== null && <div className="card-meta">Última sincronização: {formatDateTime(lastSyncAt)}</div>}
            {firstSync && (
              <p className="hint">Na primeira vez o aplicativo baixa a rede inteira dos colegas; pode demorar um pouco. Você pode continuar usando o app normalmente.</p>
            )}
            {!online && <p className="hint">Sem internet agora. Tudo continua sendo salvo neste aparelho e será enviado quando a conexão voltar.</p>}
          </section>

          {lastError && phase !== 'sincronizando' && <div className="alert" role="alert">{lastError}</div>}

          {lostEdits > 0 && (
            <section className="card" aria-label="Alterações substituídas">
              <div className="card-title">
                {lostEdits === 1 ? '1 alteração sua foi substituída' : `${lostEdits} alterações suas foram substituídas`}
              </div>
              <p className="hint">Outro aparelho seu alterou o mesmo registro mais tarde, e a versão mais recente vale. O administrador consegue ver o que foi substituído.</p>
              <button className="btn btn-block" onClick={() => void syncStore.acknowledgeLostEdits()}>Entendi</button>
            </section>
          )}

          <button className="btn btn-primary btn-block" disabled={!online || running} onClick={() => void syncStore.syncNow()}>
            {running ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>

          <BlockedList />

          <p className="hint">
            As fotos sobem junto com os dados (em rede fraca podem demorar). As fotos dos colegas só são baixadas quando você abre o elemento, para poupar internet.
          </p>
        </>
      )}
    </ScreenShell>
  );
}
