import type { ElementType } from '../../db/types';

export type Shape = 'circle' | 'square' | 'diamond' | 'hexagon' | 'triangle' | 'pentagon';

export interface ElementTypeMeta {
  type: ElementType;
  label: string;
  letter: string;
  color: string;
  textColor: string;
  /** Forma + letra + cor: o tipo nunca depende só da cor (legibilidade no sol). */
  shape: Shape;
}

export const ELEMENT_TYPES: ElementTypeMeta[] = [
  { type: 'poste', label: 'Poste', letter: 'P', color: '#ffffff', textColor: '#000000', shape: 'circle' },
  { type: 'cto', label: 'CTO', letter: 'C', color: '#34c759', textColor: '#000000', shape: 'square' },
  { type: 'ceo', label: 'CEO', letter: 'E', color: '#ff9f0a', textColor: '#000000', shape: 'diamond' },
  { type: 'reserva', label: 'Reserva', letter: 'R', color: '#af52de', textColor: '#ffffff', shape: 'hexagon' },
  { type: 'ocorrencia', label: 'Ocorrência', letter: '!', color: '#ff3b30', textColor: '#ffffff', shape: 'triangle' },
  { type: 'outro', label: 'Outro', letter: '?', color: '#5ac8fa', textColor: '#000000', shape: 'pentagon' },
];

export const ELEMENT_META = Object.fromEntries(ELEMENT_TYPES.map((m) => [m.type, m])) as Record<
  ElementType,
  ElementTypeMeta
>;

// hasOwn (e não `in`): evita aceitar chaves herdadas como 'toString'.
export const isElementType = (v: unknown): v is ElementType =>
  typeof v === 'string' && Object.hasOwn(ELEMENT_META, v);
