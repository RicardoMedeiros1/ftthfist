import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScreenShell from '../../components/ScreenShell';
import { SETTING_KEYS, getSetting } from '../../db/db';
import { goBack, navigate } from '../../lib/route';
import { activities } from '../activities/activityRepo';
import { draftStore } from '../elements/draftStore';
import { Chips } from '../elements/fields';
import { cableDraftStore } from './cableDraft';
import { useCableTypes } from './cableTypes';
import { FiberLine, LegendList } from './Legend';
import { FIBER_COUNTS } from './style';

/** Antes de lançar: tipo do cabo e nº de fibras (lembra a última escolha). */
export default function CableSetupScreen() {
  const types = useCableTypes();
  const open = useLiveQuery(() => activities.getOpen()); // undefined = carregando
  const last = useLiveQuery(() => getSetting<{ cableType: string; fiberCount: number } | null>(SETTING_KEYS.lastCable, null));
  const [cableType, setCableType] = useState('');
  const [fiberCount, setFiberCount] = useState<number>(12);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready || types === undefined || last === undefined) return;
    setCableType(last && types.includes(last.cableType) ? last.cableType : (types[0] ?? ''));
    if (last && (FIBER_COUNTS as readonly number[]).includes(last.fiberCount)) setFiberCount(last.fiberCount);
    setReady(true);
  }, [ready, types, last]);

  function start() {
    cableDraftStore.begin({ cableType, fiberCount });
    draftStore.startCable();
    goBack('map');
  }

  return (
    <ScreenShell title="Lançar cabo" onBack={() => goBack('map')}>
      {open === null ? (
        <>
          <div className="alert" role="alert">Para lançar um cabo, primeiro inicie uma atividade.</div>
          <button className="btn btn-primary btn-block" onClick={() => navigate('nova-atividade', { replace: true })}>
            Iniciar atividade
          </button>
        </>
      ) : (
        <>
          <Chips
            label="Tipo do cabo"
            value={cableType}
            options={(types ?? []).map((t) => ({ value: t, label: t }))}
            onChange={(v) => v && setCableType(v)}
          />
          <div className="field">
            <span className="label" id="fibers-label">Nº de fibras</span>
            <div className="chips fibers" role="group" aria-labelledby="fibers-label">
              {FIBER_COUNTS.map((n) => (
                <button type="button" key={n} aria-pressed={fiberCount === n} onClick={() => setFiberCount(n)}>
                  <span>{n}</span>
                  <FiberLine fiberCount={n} width={40} />
                </button>
              ))}
            </div>
          </div>
          <LegendList />
          <button className="btn btn-primary btn-block" disabled={!ready || !cableType || open === undefined} onClick={start}>
            Começar a lançar
          </button>
          <p className="hint">
            Depois, ande de poste em poste: toque em “Marcar poste aqui e ligar” em cada um. Tocar num elemento do mapa também o liga ao cabo.
          </p>
        </>
      )}
    </ScreenShell>
  );
}
