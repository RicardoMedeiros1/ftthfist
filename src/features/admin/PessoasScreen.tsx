import { useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import ScreenShell from '../../components/ScreenShell';
import { formatDateTime } from '../../lib/format';
import { goBack } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { accountStore, useAccount } from '../account/accountStore';
import type { Role } from '../account/authApi';
import { Chips } from '../elements/fields';
import { adminApi } from './adminRuntime';
import { adminErrorText, confirmText, groupPeople, patchFor, ROLE_HELP, ROLE_LABEL, type AccessChange } from './people';
import type { Person } from './adminApi';
import { useAdminData } from './useAdminData';
import './admin.css';

const ROLES: Role[] = ['tecnico', 'escritorio', 'admin'];
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

function PersonCard({ p, me, onAsk }: { p: Person; me: boolean; onAsk: (c: AccessChange) => void }) {
  const [role, setRole] = useState<Role>(p.role);
  const group = p.active ? 'ativo' : p.reviewedAt ? 'desativado' : 'pendente';
  const when = p.reviewedAt ? `${group === 'ativo' ? 'Aprovado' : 'Desativado'} em ${formatDateTime(Date.parse(p.reviewedAt))}${p.reviewedByName ? ` por ${p.reviewedByName}` : ''}` : `Pediu acesso em ${formatDateTime(Date.parse(p.createdAt))}`;
  return (
    <li className="card person" data-group={group}>
      <div className="card-title">{p.fullName || 'Sem nome'}{me ? ' (você)' : ''}</div>
      <div className="card-meta">{p.email}</div>
      <div className="card-meta">{ROLE_LABEL[p.role]} · {when}</div>
      {me ? (
        <p className="hint">Você não pode alterar o próprio acesso. Peça a outro administrador.</p>
      ) : (
        <>
          <Chips label="Papel" value={role} options={ROLE_OPTIONS} onChange={(v) => v && setRole(v as Role)} />
          <p className="hint">{ROLE_HELP[role]}</p>
          <div className="card-actions">
            {group === 'pendente' && <button className="btn btn-primary" onClick={() => onAsk({ kind: 'aprovar', role })}>Aprovar</button>}
            {group === 'desativado' && <button className="btn btn-primary" onClick={() => onAsk({ kind: 'reativar', role })}>Reativar</button>}
            {group === 'ativo' && <button className="btn" disabled={role === p.role} onClick={() => onAsk({ kind: 'papel', role })}>Mudar papel</button>}
            {group !== 'desativado' && <button className="btn btn-danger" onClick={() => onAsk({ kind: 'desativar' })}>{group === 'pendente' ? 'Recusar' : 'Desativar'}</button>}
          </div>
        </>
      )}
    </li>
  );
}

/** Pessoas: aprovar pedidos, desativar e mudar o papel. Exige internet e um administrador ativo. */
export default function PessoasScreen() {
  const online = useOnlineStatus();
  const isAdmin = useAccount((a) => a.status === 'ativo' && a.profile?.role === 'admin');
  const myId = accountStore.currentUserId();
  const list = useAdminData(() => (adminApi ? adminApi.listPeople() : Promise.resolve([])), []);
  const [ask, setAsk] = useState<{ person: Person; change: AccessChange } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => goBack('config');

  if (!isAdmin || !adminApi) {
    return (
      <ScreenShell title="Pessoas" onBack={back}>
        <div className="alert" role="alert">Esta tela é só para administradores.</div>
      </ScreenShell>
    );
  }

  async function confirm() {
    if (!ask || !adminApi || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.setAccess(ask.person.id, patchFor(ask.change));
      setAsk(null);
      list.reload();
    } catch (e) {
      setAsk(null);
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const groups = groupPeople(list.data ?? []);
  const sections: { key: keyof typeof groups; title: string; empty: string }[] = [
    { key: 'pendente', title: 'Aguardando aprovação', empty: 'Nenhum pedido novo.' },
    { key: 'ativo', title: 'Com acesso', empty: 'Ninguém com acesso ainda.' },
    { key: 'desativado', title: 'Desativados', empty: 'Ninguém desativado.' },
  ];

  return (
    <ScreenShell title="Pessoas" onBack={back}>
      {!online && <div className="alert" role="alert">Sem internet. Para ver e aprovar pessoas é preciso estar conectado.</div>}
      {list.error && <div className="alert" role="alert">{list.error}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn btn-block" onClick={list.reload} disabled={list.loading}>{list.loading ? 'Carregando…' : 'Atualizar lista'}</button>
      {list.data &&
        sections.map((s) => (
          <section key={s.key} className="field" aria-label={s.title}>
            <span className="label">{s.title} ({groups[s.key].length})</span>
            {groups[s.key].length === 0 ? (
              <p className="hint">{s.empty}</p>
            ) : (
              <ul className="people-list">
                {groups[s.key].map((p) => (
                  <PersonCard key={p.id} p={p} me={p.id === myId} onAsk={(change) => setAsk({ person: p, change })} />
                ))}
              </ul>
            )}
          </section>
        ))}
      {ask && <ConfirmDialog {...confirmText(ask.person, ask.change)} onCancel={() => setAsk(null)} onConfirm={() => void confirm()} />}
    </ScreenShell>
  );
}
