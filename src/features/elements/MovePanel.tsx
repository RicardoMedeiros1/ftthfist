import { useState } from 'react';
import { goBack } from '../../lib/route';
import { draftStore, useDraft } from './draftStore';
import { ElementRuleError, elementStore } from './elementRepo';
import { ELEMENT_META } from './meta';

/** Painel inferior ao mover um elemento: arrastar o marcador (ou tocar no mapa) e confirmar. */
export default function MovePanel() {
  const d = useDraft((s) => s);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (d.phase !== 'mover' || !d.type || !d.movingId || !d.position) return null;

  const { movingId, position } = d;
  const moved =
    d.movingFrom !== null && (position.lat !== d.movingFrom.lat || position.lng !== d.movingFrom.lng);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Mover pelo mapa é sempre posição manual: a precisão do GPS antigo deixa de valer.
      await elementStore.move(movingId!, { lat: position.lat, lng: position.lng, positionSource: 'manual' });
      draftStore.cancel();
      goBack('map');
    } catch (err) {
      setError(err instanceof ElementRuleError ? err.message : 'Não foi possível mover. Tente de novo.');
      setBusy(false);
    }
  }

  function cancel() {
    draftStore.cancel();
    goBack('map');
  }

  return (
    <div className="placement-panel" role="region" aria-label="Mover elemento">
      <div className={`placement-status ${error ? 'tone-error' : ''}`} role="status">
        <strong>{ELEMENT_META[d.type].label}</strong> ·{' '}
        {error ?? (moved ? 'Nova posição marcada. Confirme para salvar.' : 'Arraste o marcador (ou toque no mapa) para a nova posição.')}
      </div>
      <button className="btn btn-primary btn-block" disabled={!moved || busy} onClick={() => void confirm()}>
        Confirmar nova posição
      </button>
      <div className="placement-row">
        <button className="btn btn-small" onClick={cancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
