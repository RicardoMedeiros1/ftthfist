import { describe, expect, it } from 'vitest';
import { DEFAULT_CABLE_TYPES, MAX_CABLE_TYPES, MAX_TYPE_LENGTH, normalizeCableTypes } from './cableTypes';

describe('normalizeCableTypes', () => {
  it('padrão do projeto', () => {
    expect(DEFAULT_CABLE_TYPES).toEqual(['drop', 'AS-80', 'AS-120', 'outro']);
  });
  it('tira espaços e repetidos (sem diferenciar maiúsculas), mantendo a ordem', () => {
    expect(normalizeCableTypes([' AS-80 ', 'as-80', 'ASU-100', '', '   ', 'drop'])).toEqual(['AS-80', 'ASU-100', 'drop']);
  });
  it('lista vazia ou inválida volta ao padrão', () => {
    expect(normalizeCableTypes([])).toEqual(DEFAULT_CABLE_TYPES);
    expect(normalizeCableTypes('x')).toEqual(DEFAULT_CABLE_TYPES);
    expect(normalizeCableTypes(null)).toEqual(DEFAULT_CABLE_TYPES);
    expect(normalizeCableTypes([1, null, {}])).toEqual(DEFAULT_CABLE_TYPES);
  });
  it('limita tamanho e quantidade', () => {
    expect(normalizeCableTypes(['x'.repeat(100)])[0]).toHaveLength(MAX_TYPE_LENGTH);
    expect(normalizeCableTypes(Array.from({ length: 50 }, (_, i) => `t${i}`))).toHaveLength(MAX_CABLE_TYPES);
  });
});
