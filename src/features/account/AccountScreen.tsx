import { useState, type FormEvent } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import ScreenShell from '../../components/ScreenShell';
import { formatAgo } from '../../lib/format';
import { goBack } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { MIN_PASSWORD, accountStore, useAccount } from './accountStore';
import type { Role } from './authApi';
import './account.css';

export const ROLE_LABEL: Record<Role, string> = { tecnico: 'Técnico', escritorio: 'Escritório', admin: 'Administrador' };

function PasswordField({ id, label, value, onChange, autoComplete, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pass-row">
        <input id={id} type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn btn-small" aria-pressed={show} aria-label={show ? 'Ocultar a senha' : 'Mostrar a senha'} onClick={() => setShow(!show)}>
          {show ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="acc-email">E-mail</label>
      <input id="acc-email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SignedOutForms({ online }: { online: boolean }) {
  const [mode, setMode] = useState<'entrar' | 'pedir'>('entrar');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const busy = useAccount((s) => s.busy);

  function switchMode(m: 'entrar' | 'pedir') {
    setMode(m);
    accountStore.dismissNotice();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = mode === 'entrar' ? await accountStore.signIn(email, password) : await accountStore.requestAccess(name, email, password);
    if (ok) setPassword('');
  }

  return (
    <>
      <div className="seg" role="group" aria-label="O que você quer fazer">
        <button type="button" aria-pressed={mode === 'entrar'} onClick={() => switchMode('entrar')}>Entrar</button>
        <button type="button" aria-pressed={mode === 'pedir'} onClick={() => switchMode('pedir')}>Pedir acesso</button>
      </div>
      <form onSubmit={(e) => void submit(e)} className="screen-body" style={{ padding: 0 }} noValidate>
        {mode === 'pedir' && (
          <div className="field">
            <label htmlFor="acc-name">Nome completo</label>
            <input id="acc-name" type="text" autoComplete="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <p className="hint">É o nome que vai aparecer em tudo o que você registrar.</p>
          </div>
        )}
        <EmailField value={email} onChange={setEmail} />
        <PasswordField
          id="acc-password"
          label="Senha"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'}
          hint={mode === 'pedir' ? `Pelo menos ${MIN_PASSWORD} caracteres.` : undefined}
        />
        <Feedback />
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !online}>
          {busy ? 'Aguarde…' : mode === 'entrar' ? 'Entrar' : 'Pedir acesso'}
        </button>
        {mode === 'pedir' && <p className="hint">O administrador vai analisar o seu pedido. Até lá o app funciona normalmente neste aparelho, e o que você registrar fica salvo.</p>}
      </form>
    </>
  );
}

function Feedback() {
  const error = useAccount((s) => s.error);
  const notice = useAccount((s) => s.notice);
  return (
    <>
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="ok-note" role="status">{notice}</div>}
    </>
  );
}

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
        <p className="hint">Sem internet agora. Entrar, pedir acesso e trocar a senha precisam de conexão; o app continua funcionando normalmente.</p>
      )}

      {status === 'deslogado' && <SignedOutForms online={online} />}

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
          message="Os dados deste aparelho (atividades, elementos, cabos, trilhas e fotos) continuam salvos. Para voltar a usar a conta, entre de novo."
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
