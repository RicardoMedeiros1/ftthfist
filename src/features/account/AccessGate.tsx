import { useEffect } from 'react';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { formatAgo } from '../../lib/format';
import { Feedback, SignedOutForms } from './AccessForms';
import type { AccessGate as Gate } from './accessGate';
import { accountStore, useAccount } from './accountStore';
import './account.css';

/** Enquanto espera a aprovação, a tela confere sozinha de tempos em tempos (e abre o app assim que o administrador aprovar). */
const RECHECK_MS = 20_000;

const BADGE: Record<'pending' | 'disabled' | 'checking', { text: string; state: string }> = {
  pending: { text: 'Aguardando aprovação', state: 'pendente' },
  disabled: { text: 'Acesso desativado', state: 'desativado' },
  checking: { text: 'Verificando…', state: 'verificando' },
};

function WaitingPanel({ kind }: { kind: 'pending' | 'disabled' | 'checking' }) {
  const online = useOnlineStatus();
  const busy = useAccount((s) => s.busy);
  const profile = useAccount((s) => s.profile);
  const email = useAccount((s) => s.email);
  const checkedAt = useAccount((s) => s.checkedAt);

  useEffect(() => {
    if (!online) return;
    const t = setInterval(() => void accountStore.recheck(), RECHECK_MS);
    return () => clearInterval(t);
  }, [online]);

  const badge = BADGE[kind];
  return (
    <>
      <section className="card" aria-label="Situação do acesso">
        <span className={`badge-state badge-state-${badge.state}`}>{badge.text}</span>
        <div className="card-title">{profile?.fullName ?? email}</div>
        <div className="card-meta">{email}</div>
        {kind === 'pending' && <p className="hint">Seu pedido foi enviado. Quando o administrador aprovar, o app abre sozinho.</p>}
        {kind === 'disabled' && <p className="hint">O administrador desativou este acesso. Fale com ele se achar que é um engano.</p>}
        {kind === 'checking' && <p className="hint">Você está conectado, mas ainda não foi possível confirmar se o seu acesso foi aprovado. Conecte-se à internet e toque em "Verificar agora".</p>}
        {checkedAt && <div className="card-meta">Última verificação: {formatAgo(Math.max(0, Date.now() - checkedAt))}.</div>}
      </section>
      <Feedback />
      {!online && <p className="hint">Sem internet agora. Para verificar é preciso conexão.</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !online} onClick={() => void accountStore.refreshProfile()}>
        {busy ? 'Verificando…' : 'Verificar agora'}
      </button>
      <button className="btn btn-block" disabled={busy} onClick={() => void accountStore.signOut()}>
        Sair e usar outra conta
      </button>
    </>
  );
}

/**
 * Tela de acesso: fica na frente de tudo até a pessoa ter o acesso aprovado. No primeiro acesso do aparelho abre em "Pedir
 * acesso". Nada do app (mapa, GPS, dados) é montado por trás.
 */
export default function AccessGate({ gate }: { gate: Exclude<Gate, 'open'> }) {
  const online = useOnlineStatus();
  const firstAccess = useAccount((s) => s.firstAccess);
  return (
    <main className="gate" aria-label="Acesso ao RotaFibra">
      <div className="gate-inner">
        <header className="gate-head">
          <h1 className="gate-brand">RotaFibra</h1>
          {gate === 'login' && (
            <p className="gate-lead">
              {firstAccess ? 'Para usar o app, peça acesso. O administrador analisa o seu pedido.' : 'Entre com o seu e-mail e a sua senha.'}
            </p>
          )}
        </header>
        {gate === 'loading' && <div role="status">Carregando…</div>}
        {gate === 'login' && (
          <>
            {!online && <p className="hint">Sem internet. Entrar e pedir acesso precisam de conexão uma vez; depois de aprovado, o app funciona também sem internet.</p>}
            <SignedOutForms online={online} />
          </>
        )}
        {(gate === 'pending' || gate === 'disabled' || gate === 'checking') && <WaitingPanel kind={gate} />}
      </div>
    </main>
  );
}
