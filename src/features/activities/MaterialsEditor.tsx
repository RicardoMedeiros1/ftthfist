import type { Material } from '../../db/types';
import { MAX_ITEM, MAX_MATERIALS, MAX_UNIT } from './materials';

/** Linha em edicao: a quantidade e texto para aceitar "2,5" enquanto se digita. */
export interface MaterialRow {
  item: string;
  quantity: string;
  unit: string;
}

export const toRows = (list: Material[]): MaterialRow[] => list.map((m) => ({ item: m.item, quantity: String(m.quantity).replace('.', ','), unit: m.unit }));

/** "2,5" -> 2.5; vazio ou invalido -> 1 (a limpeza final e do repositorio). */
export const fromRows = (rows: MaterialRow[]): Material[] =>
  rows.map((r) => {
    const n = Number(r.quantity.trim().replace(',', '.'));
    return { item: r.item, quantity: r.quantity.trim() === '' || !Number.isFinite(n) ? 1 : n, unit: r.unit };
  });

/** Lista de materiais: item, quantidade e unidade, com botoes grandes para adicionar e remover. */
export default function MaterialsEditor({ rows, onChange }: { rows: MaterialRow[]; onChange: (rows: MaterialRow[]) => void }) {
  const set = (i: number, patch: Partial<MaterialRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="field" role="group" aria-label="Materiais">
      <span className="label">Materiais usados</span>
      {rows.map((r, i) => (
        <div className="material-row" key={i}>
          <input type="text" aria-label={`Material ${i + 1}`} placeholder="Item (ex.: abraçadeira)" value={r.item} maxLength={MAX_ITEM} onChange={(e) => set(i, { item: e.target.value })} />
          <div className="material-row-line">
            <input type="text" aria-label={`Quantidade do material ${i + 1}`} inputMode="decimal" placeholder="Qtd" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
            <input type="text" aria-label={`Unidade do material ${i + 1}`} placeholder="un, m…" value={r.unit} maxLength={MAX_UNIT} onChange={(e) => set(i, { unit: e.target.value })} />
            <button type="button" className="btn btn-danger" aria-label={`Remover material ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}
      {rows.length < MAX_MATERIALS && (
        <button type="button" className="btn btn-block" onClick={() => onChange([...rows, { item: '', quantity: '1', unit: '' }])}>
          + Adicionar material
        </button>
      )}
    </div>
  );
}
