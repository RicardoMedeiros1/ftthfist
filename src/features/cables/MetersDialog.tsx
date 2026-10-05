import { useState, type FormEvent } from 'react';
import '../../components/confirm.css';

/** Pede os metros da reserva (aceita vírgula decimal). */
export default function MetersDialog({
  title = 'Metros de reserva',
  onConfirm,
  onCancel,
}: {
  title?: string;
  onConfirm: (meters: number) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(text.trim().replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(n) || n <= 0) {
      setError('Informe um número maior que zero.');
      return;
    }
    onConfirm(Math.round(n * 100) / 100);
  }

  return (
    <div className="confirm-backdrop">
      <form className="confirm field" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit}>
        <h2>{title}</h2>
        <label htmlFor="reserve-meters" className="hint">Quantos metros de cabo ficam de reserva neste ponto?</label>
        <input
          id="reserve-meters"
          type="text"
          inputMode="decimal"
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Adicionar
          </button>
        </div>
      </form>
    </div>
  );
}
