// Cores das fibras e dos tubos de um cabo óptico. O padrão ABNT é o usado aqui (e o inicial); o internacional (TIA-598) fica
// pronto para o dia em que chegar um cabo com essas cores. Puro e testado: as telas só desenham.
//
// A sequência dos 12 primeiros vale para a fibra dentro do tubo e, de novo, para o número do tubo (tubo 1 = 1ª cor...).
// Cabo de até 12 fibras não tem tubo; acima disso, cada tubo leva FIBERS_PER_TUBE fibras. (Se um cabo trouxer outra
// quantidade por tubo, é só mudar a constante.)

import type { ColorStandard } from '../../db/types';

export type { ColorStandard };

export const DEFAULT_COLOR_STANDARD: ColorStandard = 'abnt';

export const COLOR_STANDARDS: readonly ColorStandard[] = ['abnt', 'tia598'];

export const isColorStandard = (v: unknown): v is ColorStandard => v === 'abnt' || v === 'tia598';

export const STANDARD_LABEL: Record<ColorStandard, string> = {
  abnt: 'ABNT',
  tia598: 'Internacional (TIA-598)',
};

export interface FiberColor {
  name: string;
  /** Cor da bolinha na tela. O nome sempre aparece junto: a cor nunca é a única informação (leitura no sol). */
  hex: string;
}

const VERDE: FiberColor = { name: 'Verde', hex: '#1faa3f' };
const AMARELO: FiberColor = { name: 'Amarelo', hex: '#f5d90a' };
const BRANCO: FiberColor = { name: 'Branco', hex: '#ffffff' };
const AZUL: FiberColor = { name: 'Azul', hex: '#1e63ff' };
const VERMELHO: FiberColor = { name: 'Vermelho', hex: '#e5251f' };
const VIOLETA: FiberColor = { name: 'Violeta', hex: '#8f3fd1' };
const MARROM: FiberColor = { name: 'Marrom', hex: '#8b5a2b' };
const ROSA: FiberColor = { name: 'Rosa', hex: '#ff8fc4' };
const PRETO: FiberColor = { name: 'Preto', hex: '#111111' };
const CINZA: FiberColor = { name: 'Cinza', hex: '#8e8e93' };
const LARANJA: FiberColor = { name: 'Laranja', hex: '#ff8a00' };
const AGUA: FiberColor = { name: 'Água', hex: '#22d3ee' };

/** As 12 cores, na ordem, de cada padrão. */
export const FIBER_COLORS: Record<ColorStandard, readonly FiberColor[]> = {
  abnt: [VERDE, AMARELO, BRANCO, AZUL, VERMELHO, VIOLETA, MARROM, ROSA, PRETO, CINZA, LARANJA, AGUA],
  tia598: [AZUL, LARANJA, VERDE, MARROM, CINZA, BRANCO, VERMELHO, PRETO, AMARELO, VIOLETA, ROSA, AGUA],
};

export const FIBERS_PER_TUBE = 12;

/** Quantos tubos tem o cabo; 0 = sem tubo (até 12 fibras). */
export const tubeCount = (fiberCount: number): number => (fiberCount > FIBERS_PER_TUBE ? Math.ceil(fiberCount / FIBERS_PER_TUBE) : 0);

export interface TubeInfo {
  /** 1, 2, 3... */
  number: number;
  color: FiberColor;
}

export interface FiberInfo {
  /** Número da fibra no cabo (1 a fiberCount). */
  number: number;
  color: FiberColor;
  /** Posição dentro do tubo (1 a 12). */
  position: number;
  /** Ausente em cabo sem tubo. */
  tube?: TubeInfo;
}

const colorAt = (standard: ColorStandard, index: number): FiberColor => FIBER_COLORS[standard][index % FIBER_COLORS[standard].length]!;

/** Cor e tubo da fibra `fiber` (1 a fiberCount) de um cabo; null se a fibra não existe nesse cabo. */
export function fiberInfo(fiberCount: number, fiber: number, standard: ColorStandard = DEFAULT_COLOR_STANDARD): FiberInfo | null {
  if (!Number.isInteger(fiber) || fiber < 1 || fiber > fiberCount) return null;
  const zero = fiber - 1;
  const position = (zero % FIBERS_PER_TUBE) + 1;
  const info: FiberInfo = { number: fiber, color: colorAt(standard, position - 1), position };
  if (tubeCount(fiberCount) > 0) {
    const n = Math.floor(zero / FIBERS_PER_TUBE) + 1;
    info.tube = { number: n, color: colorAt(standard, n - 1) };
  }
  return info;
}

/** "Fibra 7 · Marrom" ou, em cabo com tubos, "Fibra 19 · Marrom · Tubo 2 Amarelo". */
export function fiberLabel(info: FiberInfo): string {
  const base = `Fibra ${info.number} · ${info.color.name}`;
  return info.tube ? `${base} · Tubo ${info.tube.number} ${info.tube.color.name}` : base;
}

/** Texto curto para quando o cabo já está claro: "7 Marrom" / "19 Marrom, tubo 2 Amarelo". */
export function fiberShort(info: FiberInfo): string {
  return info.tube ? `${info.number} ${info.color.name}, tubo ${info.tube.number} ${info.tube.color.name}` : `${info.number} ${info.color.name}`;
}

export interface TubeGroup {
  /** Ausente quando o cabo não tem tubos (uma só lista de fibras). */
  tube?: TubeInfo;
  fibers: FiberInfo[];
}

/** As fibras do cabo agrupadas por tubo (ou numa lista só, se não houver tubo). */
export function fiberGroups(fiberCount: number, standard: ColorStandard = DEFAULT_COLOR_STANDARD): TubeGroup[] {
  const groups: TubeGroup[] = [];
  for (let n = 1; n <= fiberCount; n++) {
    const info = fiberInfo(fiberCount, n, standard)!;
    const last = groups[groups.length - 1];
    if (last && last.tube?.number === info.tube?.number) last.fibers.push(info);
    else groups.push({ ...(info.tube ? { tube: info.tube } : {}), fibers: [info] });
  }
  return groups;
}
