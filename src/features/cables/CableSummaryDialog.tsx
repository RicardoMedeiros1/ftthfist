import { useState } from 'react';
import '../../components/confirm.css';
import { formatMeters } from '../../lib/geo';
import { FiberLine } from './Legend';

/** Resumo ao finalizar o cabo: traçado + reservas = total, com observações. */
export default function CableSummaryDialog({
  cableType,
  fiberCount,
  length,
  reserves,
  total,
  points,
  error,
  busy,
  onSave,
  onBack,
}: {
  cableType: string;
  fiberCount: number;
  length: number;
  reserves: number;
  total: number;
  points: number;
  error: string | null;
  busy: boolean;
  onSave: (notes: string) => void;
  onBack: () => void;
}) {
  const [notes, setNotes] = useState('');
  return (
    <div className="confirm-backdrop">
      <div className="confirm field" role="dialog" aria-modal="true" aria-labelledby="sum-title">
        <h2 id="sum-title">Finalizar cabo</h2>
        <div className="row">
          <FiberLine fiberCount={fiberCount} />
          <strong>{cableType} · {fiberCount} fibras · {points} pontos</strong>
        </div>
        <div className="summary-math" role="status">
          <span>Traçado {formatMeters(length)}</span>
          <span>+ Reservas {formatMeters(reserves)}</span>
          <strong>= Total {formatMeters(total)}</strong>
        </div>
        <label htmlFor="cable-notes" className="hint">Observações (opcional)</label>
        <textarea id="cable-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="confirm-actions">
          <button className="btn" onClick={onBack} disabled={busy}>
            Voltar
          </button>
          <button className="btn btn-primary" onClick={() => onSave(notes)} disabled={busy}>
            Salvar cabo
          </button>
        </div>
      </div>
    </div>
  );
}
