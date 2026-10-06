import { useEffect, useState } from 'react';
import ScreenShell from '../../components/ScreenShell';
import { goBack, navigate } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { useAccount } from '../account/accountStore';
import { Chips } from '../elements/fields';
import type { ChangeEntry } from './adminApi';
import { adminApi } from './adminRuntime';
import { describeChange, ids, type ChangeKind } from './changes';
import { adminErrorText } from './people';
import './admin.css';

const PAGE = 20;

interface Loaded {
  entries: ChangeEntry[];
  names: Map<string, string>;
  more: boolean;
}

/** Alterações feitas por quem não é o dono e edições atrasadas que o servidor recusou. Só leitura. */
export default function AlteracoesScreen() {
  const online = useOnlineStatus();
  const isAdmin = useAccount((a) => a.status === 'ativo' && a.profile?.role === 'admin');
  const [kind, setKind] = useState<ChangeKind>('alteracao');
  const [state, setState] = useState<{ kind: ChangeKind; data: Loaded | null; loading: boolean; error: string | null }>({ kind: 'alteracao', data: null, loading: false, error: null });
  const back = () => goBack('config');

  async function load(k: ChangeKind, more: boolean) {
    if (!adminApi) return;
    const base = more && state.kind === k ? state.data : null;
    setState({ kind: k, data: base, loading: true, error: null });
    try {
      const before = base?.entries.at(-1)?.id;
      const page = await (k === 'alteracao' ? adminApi.listEdits(PAGE, before) : adminApi.listConflicts(PAGE, before));
      const names = new Map(base?.names);
      for (const [id, n] of await adminApi.names(ids(page))) names.set(id, n);
      setState({ kind: k, data: { entries: [...(base?.entries ?? []), ...page], names, more: page.length === PAGE }, loading: false, error: null });
    } catch (e) {
      setState({ kind: k, data: base, loading: false, error: adminErrorText(e) });
    }
  }

  // abre ja carregando; trocar entre Alterações e Conflitos carrega a outra lista
  useEffect(() => {
    if (isAdmin) void load(kind, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, isAdmin]);

  if (!isAdmin || !adminApi) {
    return (
      <ScreenShell title="Alterações" onBack={back}>
        <div className="alert" role="alert">Esta tela é só para administradores.</div>
      </ScreenShell>
    );
  }

  const shown = state.kind === kind ? state.data : null;
  return (
    <ScreenShell title="Alterações e conflitos" onBack={back}>
      {!online && <div className="alert" role="alert">Sem internet. Esta lista vem do servidor.</div>}
      <Chips
        label="Mostrar"
        value={kind}
        options={[
          { value: 'alteracao', label: 'Alterações' },
          { value: 'conflito', label: 'Conflitos' },
        ]}
        onChange={(v) => {
          if (v) {
            setKind(v as ChangeKind);
            setState({ kind: v as ChangeKind, data: null, loading: false, error: null });
          }
        }}
      />
      <p className="hint">
        {kind === 'alteracao'
          ? 'Cada vez que um administrador mudou o registro de outra pessoa: quem, quando, como era e como ficou.'
          : 'Edições que chegaram atrasadas (o aparelho estava sem internet) depois de uma versão mais nova. O servidor manteve a mais nova; aqui está o que foi recusado.'}
      </p>
      <button className="btn btn-block" disabled={state.loading} onClick={() => void load(kind, false)}>
        {state.loading ? 'Carregando…' : 'Atualizar'}
      </button>
      {state.error && state.kind === kind && <div className="alert" role="alert">{state.error}</div>}
      {shown && shown.entries.length === 0 && <p className="hint">Nada por aqui.</p>}
      {shown && (
        <ul className="change-list">
          {shown.entries.map((e) => {
            const v = describeChange(kind, e, shown.names);
            return (
              <li key={v.key} className="card">
                <div className="card-title">{v.headline}</div>
                <div className="card-meta">{v.owner} · {v.when}</div>
                {v.changes.length === 0 ? (
                  <p className="hint">Sem diferença visível (só controle interno).</p>
                ) : (
                  <ul className="change-fields">
                    {v.changes.map((c) => (
                      <li key={c.label}>
                        <strong>{c.label}:</strong> {c.before}{kind === 'conflito' ? ' · ' : ' → '}{c.after}
                      </li>
                    ))}
                  </ul>
                )}
                {v.open && <button className="btn" onClick={() => navigate(v.open!.route, { id: v.open!.id })}>Abrir</button>}
              </li>
            );
          })}
        </ul>
      )}
      {shown?.more && <button className="btn btn-block" disabled={state.loading} onClick={() => void load(kind, true)}>Mostrar mais antigas</button>}
    </ScreenShell>
  );
}
