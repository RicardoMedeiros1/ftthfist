import type { Material } from '../../db/types';

export const MAX_MATERIALS = 100;
export const MAX_DESCRIPTION = 2000;
export const MAX_ITEM = 80;
export const MAX_UNIT = 20;

/** Limpa a lista de materiais digitada: tira linhas sem item, aparas, quantidade invalida vira 1, limites de tamanho. */
export function sanitizeMaterials(input: Material[]): Material[] {
  const out: Material[] = [];
  for (const m of input) {
    const item = String(m.item ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_ITEM);
    if (!item) continue;
    const q = Number(m.quantity);
    const quantity = Number.isFinite(q) && q >= 0 ? Math.round(q * 100) / 100 : 1;
    out.push({ item, quantity, unit: String(m.unit ?? '').trim().slice(0, MAX_UNIT) });
    if (out.length >= MAX_MATERIALS) break;
  }
  return out;
}

/** "2 m" / "3 un" / "5": como a quantidade aparece na lista. */
export const formatMaterial = (m: Material) => {
  const q = String(m.quantity).replace('.', ',');
  return m.unit ? `${q} ${m.unit}` : q;
};
