import { useEffect, useState, type FormEvent } from 'react';
import ScreenShell from '../../components/ScreenShell';
import { SETTING_KEYS, setSetting } from '../../db/db';
import type { ActivityKind } from '../../db/types';
import { goBack, navigate } from '../../lib/route';
import { draftStore, useDraft } from '../elements/draftStore';
import { useTechnician } from '../settings/useTechnician';
import { ActivityRuleError, activities } from './activityRepo';
import { KIND_LABEL } from './labels';

export default function NewActivityScreen() {
  const savedTechnician = useTechnician();
  const needsActivityHint = useDraft((s) => s.needsActivityHint);
  const [kind, setKind] = useState<ActivityKind>('implantacao');
  const [title, setTitle] = useState('');
  const [osNumber, setOsNumber] = useState('');
  const [technician, setTechnician] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (savedTechnician !== undefined) setTechnician(savedTechnician);
  }, [savedTechnician]);

  // O aviso vale só para esta visita à tela.
  useEffect(() => draftStore.clearHint, []);

  const needsName = savedTechnician === '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // O nome só é pedido aqui na primeira vez; fica salvo nas Configurações.
      if (needsName && technician.trim()) await setSetting(SETTING_KEYS.technician, technician.trim());
      await activities.create({ kind, title, osNumber }, technician);
      navigate('map', { replace: true });
    } catch (err) {
      setError(err instanceof ActivityRuleError ? err.message : 'Não foi possível salvar. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <ScreenShell title="Nova atividade" onBack={() => goBack('atividades')}>
      <form onSubmit={onSubmit} className="screen-body" style={{ padding: 0 }}>
        {needsActivityHint && (
          <div className="ok-note" role="status">
            Para marcar elementos no mapa, primeiro inicie uma atividade.
          </div>
        )}
        <div className="field">
          <span className="label" id="kind-label">Tipo</span>
          <div className="seg" role="group" aria-labelledby="kind-label">
            {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
              <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="title">Título</label>
          <input
            id="title"
            type="text"
            placeholder="Ex.: Rua das Flores — trecho 1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="os">Nº da OS (opcional)</label>
          <input id="os" type="text" inputMode="text" value={osNumber} onChange={(e) => setOsNumber(e.target.value)} />
        </div>

        {needsName ? (
          <div className="field">
            <label htmlFor="tech">Seu nome</label>
            <input
              id="tech"
              type="text"
              autoComplete="name"
              value={technician}
              onChange={(e) => setTechnician(e.target.value)}
              required
            />
            <p className="hint">Pedido só desta vez; fica salvo nas Configurações.</p>
          </div>
        ) : (
          <p className="hint">Técnico: <strong>{savedTechnician ?? '…'}</strong></p>
        )}

        {error && <div className="alert" role="alert">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy || savedTechnician === undefined}>
          Iniciar atividade
        </button>
      </form>
    </ScreenShell>
  );
}
