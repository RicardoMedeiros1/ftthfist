import type { ElementType } from '../../db/types';
import { ELEMENT_META, type Shape } from './meta';

const HIGHLIGHT = '#ffd400';

const POINTS: Record<Exclude<Shape, 'circle' | 'square'>, string> = {
  diamond: '20,5 35,20 20,35 5,20',
  hexagon: '35,20 27.5,33 12.5,33 5,20 12.5,7 27.5,7',
  triangle: '20,6 35,33 5,33',
  pentagon: '20,5 34.3,15.4 28.8,32.1 11.2,32.1 5.7,15.4',
};

// Linha de base da letra, para ficar visualmente centrada em cada forma.
const BASELINE: Record<Shape, number> = {
  circle: 25.5,
  square: 25.5,
  diamond: 25.5,
  hexagon: 25.5,
  triangle: 31,
  pentagon: 26.5,
};

function shape(s: Shape, attrs: string): string {
  switch (s) {
    case 'circle':
      return `<circle cx="20" cy="20" r="13" ${attrs}/>`;
    case 'square':
      return `<rect x="7" y="7" width="26" height="26" rx="5" ${attrs}/>`;
    default:
      return `<polygon points="${POINTS[s]}" ${attrs}/>`;
  }
}

/** SVG do ícone do elemento. `highlighted` desenha um halo amarelo (atividade aberta). */
export function elementSvg(type: ElementType, opts: { highlighted?: boolean; size?: number } = {}): string {
  const { highlighted = false, size = 32 } = opts;
  const m = ELEMENT_META[type];
  const round = 'stroke-linejoin="round"';
  const halo = highlighted
    ? shape(m.shape, `fill="none" stroke="#000" stroke-width="11" ${round}`) +
      shape(m.shape, `fill="none" stroke="${HIGHLIGHT}" stroke-width="8" ${round}`)
    : '';
  const body = shape(m.shape, `fill="${m.color}" stroke="#000" stroke-width="3" ${round}`);
  const fontSize = m.shape === 'triangle' ? 14 : 16;
  const letter = `<text x="20" y="${BASELINE[m.shape]}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="800" fill="${m.textColor}">${m.letter}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" style="overflow:visible" aria-hidden="true">${halo}${body}${letter}</svg>`;
}
