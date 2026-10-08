import { useState, type FormEvent } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import ScreenShell from '../../components/ScreenShell';
import { formatAgo } from '../../lib/format';
import { goBack } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { Feedback, PasswordField } from './AccessForms';
import { MIN_PASSWORD, accountStore, useAccount } from './accountStore';
import type { Role } from './authApi';
import './account.css';

export const ROLE_LABEL: Record<Role, string> = { tecnico: 'Técnico', escritorio: 'Escritório', admin: 'Administrador' };

function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const busy = useAccount((s) => s.busy);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await accountStore.changePassword(pw, again)) {
      setPw('');
      setAgain('');
      setOpen(false);
    }
  }
  if (!open) {
    return (
      <button className="btn btn-block" onClick={() => { accountStore.dismissNotice(); setOpen(true); }}>
        Alterar minha senha
      </button>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="screen-body" style={{ padding: 0 }} noValidate aria-label="Alterar senha">
      <PasswordField id="acc-new" label="Nova senha" value={pw} onChange={setPw} autoComplete="new-password" hint={`Pelo menos ${MIN_PASSWORD} caracteres.`} />
      <PasswordField id="acc-again" label="Repita a nova senha" value={again} onChange={setAgain} autoComplete="new-password" />
      <Feedback />
      <div className="placement-row">
        <button type="button" className="btn" onClick={() => { accountStore.dismissNotice(); setOpen(false); }}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>Salvar senha</button>
      </div>
    </form>
  );
}

export default function AccountScreen() {
  const state = useAccount((s) => s);
  const online = useOnlineStatus();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const { status, profile, email, busy, checkedAt } = state;

  const verifiedAgo = checkedAt ? `Última verificação: ${formatAgo(Math.max(0, Date.now() - checkedAt))}.` : null;

  return (
    <ScreenShell title="Conta" onBack={() => goBack('config')}>
      {status === 'sem-configuracao' && (
        <p className="hint">Este aplicativo não está ligado a um servidor. Ele funciona normalmente, só neste aparelho.</p>
      )}
      {status === 'carregando' && <div role="status">Carregando…</div>}

      {status !== 'sem-configuracao' && status !== 'carregando' && !online && (
        <p className="hint">Sem internet agora. Trocar a senha e verificar o acesso precisam de conexão; o app continua funcionando normalmente.</p>
      )}

      {(status === 'verificando' || status === 'pendente' || status === 'desativado' || status === 'ativo') && (
        <>
          <section className="card" aria-label="Situação da conta">
            <span className={`badge-state badge-state-${status}`}>
              {status === 'ativo' ? 'Acesso aprovado' : status === 'pendente' ? 'Aguardando aprovação' : status === 'desativado' ? 'Acesso desativado' : 'Verificando…'}
            </span>
            <div className="card-title">{profile?.fullName ?? email}</div>
            <div className="card-meta">{email}</div>
            {profile && status === 'ativo' && <div className="card-meta">Perfil: {ROLE_LABEL[profile.role]}</div>}
            {status === 'pendente' && (
              <p className="hint">Seu pedido foi enviado. Assim que o administrador aprovar, você poderá enviar seus dados ao servidor. Enquanto isso o app funciona normalmente neste aparelho.</p>
            )}
            {status === 'desativado' && <p className="hint">O administrador desativou este acesso. Fale com ele se achar que é um engano.</p>}
            {status === 'verificando' && <p className="hint">Você está conectado, mas ainda não foi possível confirmar se o seu acesso foi aprovado (sem internet?).</p>}
            {verifiedAgo && <div className="card-meta">{verifiedAgo}</div>}
          </section>

          <Feedback />

          {status !== 'ativo' && (
            <button className="btn btn-primary btn-block" disabled={busy || !online} onClick={() => void accountStore.refreshProfile()}>
              {busy ? 'Verificando…' : 'Verificar agora'}
            </button>
          )}
          {status === 'ativo' && <PasswordChange />}
          <button className="btn btn-block" disabled={busy} onClick={() => setConfirmSignOut(true)}>Sair da conta</button>
        </>
      )}

      {confirmSignOut && (
        <ConfirmDialog
          title="Sair da conta?"
          message="Os dados deste aparelho (atividades, elementos, cabos, trilhas e fotos) continuam salvos. Para voltar a usar o app, entre de novo (precisa de internet)."
          confirmLabel="Sair"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => {
            setConfirmSignOut(false);
            void accountStore.signOut();
          }}
        />
      )}
    </ScreenShell>
  );
}
