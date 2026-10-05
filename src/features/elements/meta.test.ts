import { describe, expect, it } from 'vitest';
import { elementSvg } from './elementSvg';
import { ELEMENT_TYPES, isElementType } from './meta';

describe('identidade visual dos tipos', () => {
  it('cada tipo tem letra, cor e forma próprias (não depende só da cor)', () => {
    expect(ELEMENT_TYPES).toHaveLength(6);
    for (const key of ['letter', 'color', 'shape'] as const) {
      expect(new Set(ELEMENT_TYPES.map((m) => m[key])).size).toBe(ELEMENT_TYPES.length);
    }
  });

  it('o SVG traz a letra do tipo; só o destacado tem o halo amarelo', () => {
    for (const m of ELEMENT_TYPES) {
      expect(elementSvg(m.type)).toContain(`>${m.letter}</text>`);
      expect(elementSvg(m.type)).not.toContain('#ffd400');
      expect(elementSvg(m.type, { highlighted: true })).toContain('#ffd400');
    }
  });

  it('respeita o tamanho pedido', () => {
    expect(elementSvg('poste', { size: 44 })).toContain('width="44" height="44"');
  });

  it('isElementType só aceita os seis tipos', () => {
    expect(isElementType('cto')).toBe(true);
    expect(isElementType('toString')).toBe(false);
    expect(isElementType(7)).toBe(false);
  });
});
