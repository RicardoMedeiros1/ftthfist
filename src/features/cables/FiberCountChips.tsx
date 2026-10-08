import { FiberLine } from './Legend';
import { FIBER_COUNTS } from './style';

/** Botões do nº de fibras do cabo, cada um com a linha na espessura/cor que o cabo terá no mapa. `compact`: 5 por linha (diálogos). */
export default function FiberCountChips({ value, onChange, compact = false }: { value: number; onChange: (n: number) => void; compact?: boolean }) {
  return (
    <div className="field">
      <span className="label" id="fibers-label">Nº de fibras</span>
      <div className={compact ? 'chips fibers compact' : 'chips fibers'} role="group" aria-labelledby="fibers-label">
        {FIBER_COUNTS.map((n) => (
          <button type="button" key={n} aria-pressed={value === n} onClick={() => onChange(n)}>
            <span>{n}</span>
            <FiberLine fiberCount={n} width={compact ? 30 : 40} />
          </button>
        ))}
      </div>
    </div>
  );
}
