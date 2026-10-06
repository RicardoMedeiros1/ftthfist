import { describe, expect, it } from 'vitest';
import { MAX_ITEM, MAX_MATERIALS, MAX_UNIT, formatMaterial, sanitizeMaterials } from './materials';

describe('sanitizeMaterials', () => {
  it('tira as linhas sem item, apara e junta espaços', () => {
    expect(sanitizeMaterials([
      { item: '  Fita   de aço ', quantity: 3, unit: ' m ' },
      { item: '   ', quantity: 5, unit: 'un' },
      { item: '', quantity: 1, unit: '' },
    ])).toEqual([{ item: 'Fita de aço', quantity: 3, unit: 'm' }]);
  });

  it('quantidade inválida (negativa, NaN, texto) vira 1; decimais ficam com 2 casas', () => {
    const r = sanitizeMaterials([
      { item: 'a', quantity: -4, unit: '' },
      { item: 'b', quantity: Number.NaN, unit: '' },
      { item: 'c', quantity: 'x' as unknown as number, unit: '' },
      { item: 'd', quantity: 2.456, unit: '' },
      { item: 'e', quantity: 0, unit: '' },
    ]);
    expect(r.map((m) => m.quantity)).toEqual([1, 1, 1, 2.46, 0]);
  });

  it('limites de tamanho do item, da unidade e da lista', () => {
    const r = sanitizeMaterials([{ item: 'x'.repeat(500), quantity: 1, unit: 'u'.repeat(99) }]);
    expect(r[0]!.item).toHaveLength(MAX_ITEM);
    expect(r[0]!.unit).toHaveLength(MAX_UNIT);
    const many = sanitizeMaterials(Array.from({ length: MAX_MATERIALS + 30 }, (_, i) => ({ item: `i${i}`, quantity: 1, unit: '' })));
    expect(many).toHaveLength(MAX_MATERIALS);
  });

  it('não confia no formato do que recebe (campos ausentes ou nulos)', () => {
    expect(sanitizeMaterials([{ item: null, quantity: 2, unit: undefined } as never, { quantity: 1 } as never])).toEqual([]);
    expect(sanitizeMaterials([{ item: 'ok', quantity: 2, unit: null } as never])).toEqual([{ item: 'ok', quantity: 2, unit: '' }]);
  });
});

describe('formatMaterial', () => {
  it('quantidade com vírgula e unidade', () => {
    expect(formatMaterial({ item: 'x', quantity: 2.5, unit: 'm' })).toBe('2,5 m');
    expect(formatMaterial({ item: 'x', quantity: 3, unit: '' })).toBe('3');
  });
});
