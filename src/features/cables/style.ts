// Estilo do cabo no mapa pelo nº de fibras (cor + espessura) e a legenda correspondente.

export const FIBER_COUNTS = [1, 2, 4, 6, 12, 24, 36, 48, 72, 144] as const;
export type FiberCount = (typeof FIBER_COUNTS)[number];

export const isFiberCount = (n: unknown): n is FiberCount => (FIBER_COUNTS as readonly unknown[]).includes(n);

export interface LegendItem {
  label: string;
  counts: readonly number[];
  color: string;
  weight: number;
}

// Cada grupo cresce em espessura, para distinguir também sem depender só da cor.
export const LEGEND: readonly LegendItem[] = [
  { label: '1–2 fibras (drop)', counts: [1, 2], color: '#00e5ff', weight: 3 },
  { label: '4–12 fibras', counts: [4, 6, 12], color: '#2979ff', weight: 4 },
  { label: '24–36 fibras', counts: [24, 36], color: '#00c853', weight: 5 },
  { label: '48 fibras', counts: [48], color: '#ffab00', weight: 6 },
  { label: '72 fibras', counts: [72], color: '#d500f9', weight: 7 },
  { label: '144 fibras', counts: [144], color: '#ff1744', weight: 8 },
];

export interface CableStyle {
  color: string;
  weight: number;
}

const FALLBACK: CableStyle = { color: '#9e9e9e', weight: 3 };

export function cableStyle(fiberCount: number): CableStyle {
  const g = LEGEND.find((l) => l.counts.includes(fiberCount));
  return g ? { color: g.color, weight: g.weight } : FALLBACK;
}

/** Contorno preto sob a linha colorida: legível sobre rua (claro) e satélite (escuro). */
export const CASING_COLOR = '#000000';
export const CASING_EXTRA = 3;
