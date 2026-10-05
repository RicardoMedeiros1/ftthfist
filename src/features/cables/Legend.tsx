import { CASING_COLOR, CASING_EXTRA, LEGEND, cableStyle } from './style';

/** Amostra da linha do cabo (com o mesmo contorno preto do mapa). */
export function FiberLine({ fiberCount, width = 44 }: { fiberCount: number; width?: number }) {
  const st = cableStyle(fiberCount);
  const h = 16;
  return (
    <svg width={width} height={h} aria-hidden="true" className="fiber-line">
      <line x1="3" y1={h / 2} x2={width - 3} y2={h / 2} stroke={CASING_COLOR} strokeWidth={st.weight + CASING_EXTRA} strokeLinecap="round" />
      <line x1="3" y1={h / 2} x2={width - 3} y2={h / 2} stroke={st.color} strokeWidth={st.weight} strokeLinecap="round" />
    </svg>
  );
}

export function LegendList() {
  return (
    <ul className="legend-list" aria-label="Legenda dos cabos">
      {LEGEND.map((l) => (
        <li key={l.label}>
          <FiberLine fiberCount={l.counts[0]!} />
          <span>{l.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Legenda em tela cheia sobre o mapa (botão "Legenda"). */
export function LegendSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet legend-sheet" role="dialog" aria-label="Legenda dos cabos">
      <div className="sheet-title">Legenda dos cabos</div>
      <LegendList />
      <button className="btn btn-block" onClick={onClose}>
        Fechar
      </button>
    </div>
  );
}
