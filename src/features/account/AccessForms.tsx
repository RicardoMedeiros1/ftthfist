import { useState, type FormEvent } from 'react';
import { useNow } from '../../lib/useNow';
import { MIN_PASSWORD, accountStore, useAccount } from './accountStore';
import { formatWait } from './attemptLimiter';
import './account.css';

export function PasswordField({ id, label, value, onChange, autoComplete, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string }) {
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

export function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="acc-email">E-mail</label>
      <input id="acc-email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Feedback() {
  const error = useAccount((s) => s.error);
  const notice = useAccount((s) => s.notice);
  return (
    <>
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="ok-note" role="status">{notice}</div>}
    </>
  );
}

/** Pedir acesso / Entrar. No primeiro acesso do aparelho abre em "Pedir acesso". */
export function SignedOutForms({ online }: { online: boolean }) {
  const firstAccess = useAccount((s) => s.firstAccess);
  const lockedUntil = useAccount((s) => s.lockedUntil);
  const busy = useAccount((s) => s.busy);
  const [picked, setPicked] = useState<'entrar' | 'pedir' | null>(null);
  const mode = picked ?? (firstAccess ? 'pedir' : 'entrar');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Travado por erros seguidos: o botão fica apagado com a contagem regressiva
  const now = useNow(lockedUntil !== null);
  const wait = lockedUntil !== null ? Math.max(0, lockedUntil - now) : 0;
  const locked = wait > 0;

  function switchMode(m: 'entrar' | 'pedir') {
    setPicked(m);
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
        <button type="button" aria-pressed={mode === 'pedir'} onClick={() => switchMode('pedir')}>Pedir acesso</button>
        <button type="button" aria-pressed={mode === 'entrar'} onClick={() => switchMode('entrar')}>Entrar</button>
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
        {!locked && <Feedback />}
        {locked && (
          <div className="alert" role="status" data-testid="lock-notice">
            Muitas tentativas. Tente de novo em <strong>{formatWait(wait)}</strong>.
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !online || locked}>
          {busy ? 'Aguarde…' : locked ? `Aguarde ${formatWait(wait)}` : mode === 'entrar' ? 'Entrar' : 'Pedir acesso'}
        </button>
        {mode === 'pedir' && <p className="hint">O administrador vai analisar o seu pedido. Depois de aprovado, o app abre direto, até sem internet.</p>}
      </form>
    </>
  );
}
