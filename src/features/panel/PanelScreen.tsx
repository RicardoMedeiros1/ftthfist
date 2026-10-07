import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { formatAgo } from '../../lib/format';
import { formatMeters } from '../../lib/geo';
import { navigate, useRouteId } from '../../lib/route';
import { useNow } from '../../lib/useNow';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { useAccount } from '../account/accountStore';
import { syncStore, useSync } from '../sync/syncRuntime';
import { ACCESS_TEXT, panelAccess } from './access';
import { overview } from './overview';
import { PANEL_SECTIONS, sectionOf } from './sections';
import './panel.css';

function Tile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="total-tile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Overview() {
  const data = useLiveQuery(async () => ({
    activities: await db.activities.toArray(),
    elements: await db.elements.toArray(),
    cables: await db.cables.toArray(),
    photos: await db.photos.toArray(),
  }));
  const lastSyncAt = useSync((s) => s.lastSyncAt);
  const running = useSync((s) => s.phase === 'sincronizando');
  const online = useOnlineStatus();
  const now = useNow(true, 30_000);
  if (!data) return null;
  const o = overview(data);
  return (
    <>
      <section className="field" aria-label="Totais da rede">
        <span className="label">A rede que este navegador conhece</span>
        <div className="totals panel-totals">
          <Tile value={o.technicians} label={o.technicians === 1 ? 'técnico' : 'técnicos'} />
          <Tile value={o.activities} label={`${o.activities === 1 ? 'atividade' : 'atividades'} · ${o.openActivities} em aberto`} />
          <Tile value={o.elements} label={`${o.elements === 1 ? 'elemento' : 'elementos'}${o.byType.length > 0 ? ` · ${o.byType.map((t) => `${t.count} ${t.label}`).join(' · ')}` : ''}`} />
          <Tile value={o.cables} label={o.cables === 1 ? 'cabo' : 'cabos'} />
          <Tile value={formatMeters(o.totalMeters)} label={`de cabo (traçado ${formatMeters(o.lengthMeters)} + reservas ${formatMeters(o.reserveMeters)})`} />
          <Tile value={o.photos} label={o.photos === 1 ? 'foto' : 'fotos'} />
        </div>
      </section>
      <section className="field" aria-label="Atualização dos dados">
        <span className="label">Atualização</span>
        <p className="hint">
          O painel mostra o que já foi sincronizado neste navegador
          {lastSyncAt ? ` (última sincronização ${formatAgo(now - lastSyncAt)})` : ' (ainda não sincronizou)'}. Funciona também sem internet.
        </p>
        <button className="btn" disabled={!online || running} onClick={() => void syncStore.syncNow()}>
          {running ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </section>
    </>
  );
}

/** Painel web para o escritorio/NOC (so leitura): ver a rede e o historico no computador. Passo 1: a casca e a visao geral. */
export default function PanelScreen() {
  const status = useAccount((a) => a.status);
  const role = useAccount((a) => a.profile?.role);
  const section = sectionOf(useRouteId());
  const access = panelAccess(status, role);

  if (access !== 'liberado') {
    return (
      <div className="panel" role="dialog" aria-modal="true" aria-label="Painel">
        <div className="panel-main">
          <h1>Painel</h1>
          <div className="alert" role="alert">{ACCESS_TEXT[access]}</div>
          <button className="btn" onClick={() => navigate(access === 'sem-conta' ? 'conta' : 'map')}>
            {access === 'sem-conta' ? 'Entrar na conta' : 'Voltar ao mapa'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel" role="dialog" aria-modal="true" aria-label="Painel">
      <nav className="panel-nav" aria-label="Seções do painel">
        <div className="panel-brand">RotaFibra</div>
        {PANEL_SECTIONS.map((s) =>
          s.kind === 'em-breve' ? (
            <button key={s.id} className="panel-link" disabled aria-label={`${s.label} (em breve)`}>
              {s.label}
              <small>em breve</small>
            </button>
          ) : (
            <button
              key={s.id}
              className="panel-link"
              aria-current={s.id === section.id ? 'page' : undefined}
              onClick={() => (s.kind === 'tela' ? navigate(s.route) : navigate('painel', { id: s.id }))}
            >
              {s.label}
            </button>
          ),
        )}
        <button className="panel-link panel-exit" onClick={() => navigate('map')}>
          Voltar ao mapa do app
        </button>
      </nav>
      <main className="panel-main">
        <h1>{section.label}</h1>
        {section.kind === 'aqui' ? <Overview /> : <p className="hint">Esta seção ainda não está pronta.</p>}
      </main>
    </div>
  );
}
