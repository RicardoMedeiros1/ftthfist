import type { ReactNode } from 'react';
import { classifyAccuracy, formatAccuracy } from '../../lib/geo';
import { navigate } from '../../lib/route';
import { draftStore, useDraft } from './draftStore';
import { ELEMENT_META } from './meta';

type Tone = 'info' | 'warn' | 'error';

/** Painel inferior da marcação: mostra o estado da posição e as ações possíveis. */
export default function PlacementPanel() {
  const d = useDraft((s) => s);
  if (d.phase !== 'posicao' || !d.type) return null;

  const label = ELEMENT_META[d.type].label;
  const pos = d.position;
  const searching = d.mode === 'gps' && d.capture === 'buscando';
  const failed = d.mode === 'gps' && d.capture === 'erro';
  const bad = !searching && pos?.accuracy !== undefined && classifyAccuracy(pos.accuracy) === 'ruim';
  const secs = Math.floor(d.elapsedMs / 1000);

  let tone: Tone = 'info';
  let status: ReactNode;
  if (searching) {
    status = pos
      ? `Buscando GPS… ${formatAccuracy(pos.accuracy ?? 0)} · ${secs} s`
      : secs >= 10
        ? 'Ainda sem sinal de GPS. Aguarde ou toque no mapa.'
        : `Buscando GPS… ${secs} s`;
  } else if (failed) {
    tone = 'error';
    status = d.error;
  } else if (d.mode === 'manual' && !pos) {
    status = `Toque no mapa onde fica o ${label}.`;
  } else if (pos?.source === 'manual') {
    status = d.mode === 'manual' ? 'Posição marcada no mapa. Arraste o marcador para ajustar.' : 'Posição ajustada manualmente.';
  } else if (bad && pos?.accuracy !== undefined) {
    tone = 'warn';
    status = `Precisão baixa (${formatAccuracy(pos.accuracy)}). Arraste o marcador até o ponto certo.`;
  } else if (pos?.accuracy !== undefined) {
    status = `GPS ${formatAccuracy(pos.accuracy)}. Posição pronta.`;
  }

  const canContinue = !!pos && !searching;

  return (
    <div className="placement-panel" role="region" aria-label={`Posição: ${label}`}>
      <div className={`placement-status tone-${tone}`} role="status">
        <strong>{label}</strong> · {status}
      </div>

      {searching ? (
        <button className="btn btn-primary btn-block" disabled={!pos} onClick={draftStore.finishCapture}>
          Usar esta posição
        </button>
      ) : failed ? (
        <button className="btn btn-primary btn-block" onClick={draftStore.retryGps}>
          Tentar GPS de novo
        </button>
      ) : (
        <button className="btn btn-primary btn-block" disabled={!canContinue} onClick={() => navigate('novo-elemento')}>
          Continuar
        </button>
      )}

      <div className="placement-row">
        {d.mode === 'gps' ? (
          <button className="btn btn-small" onClick={draftStore.useManual}>
            Tocar no mapa
          </button>
        ) : (
          <button className="btn btn-small" onClick={draftStore.retryGps}>
            Usar GPS
          </button>
        )}
        {!searching && !failed && d.mode === 'gps' && (
          <button className="btn btn-small" onClick={draftStore.retryGps}>
            Buscar de novo
          </button>
        )}
        <button className="btn btn-small" onClick={draftStore.cancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
