import { describe, expect, it } from 'vitest';
import { attrsToFormStrings, describeAttrs, formatNumber } from './attrsView';

describe('describeAttrs', () => {
  it('poste', () => {
    expect(describeAttrs({ type: 'poste', attrs: { owner: 'concessionaria', ownerCode: 'A-55' } })).toEqual([
      { label: 'Dono', value: 'Concessionária' },
      { label: 'Plaqueta da concessionária', value: 'A-55' },
    ]);
  });
  it('só mostra o que foi preenchido', () => {
    expect(describeAttrs({ type: 'cto', attrs: {} })).toEqual([]);
    expect(describeAttrs({ type: 'outro', attrs: {} })).toEqual([]);
    expect(describeAttrs({ type: 'cto', attrs: { capacity: 16 } })).toEqual([{ label: 'Capacidade', value: '16 portas' }]);
  });
  it('números no formato brasileiro e zero é valor válido', () => {
    expect(describeAttrs({ type: 'reserva', attrs: { meters: 12.5 } })).toEqual([{ label: 'Reserva', value: '12,5 m' }]);
    expect(describeAttrs({ type: 'ceo', attrs: { trays: 0, splices: 12 } })).toEqual([
      { label: 'Bandejas', value: '0' },
      { label: 'Emendas', value: '12' },
    ]);
  });
  it('ocorrência', () => {
    expect(describeAttrs({ type: 'ocorrencia', attrs: { problem: 'poste_caido', actionTaken: 'troca' } })).toEqual([
      { label: 'Problema', value: 'Poste caído' },
      { label: 'O que foi feito', value: 'troca' },
    ]);
  });
});

describe('attrsToFormStrings', () => {
  it('números viram texto com vírgula e voltam sem perda na normalização', () => {
    expect(attrsToFormStrings({ meters: 12.5, capacity: 16, splitter: '1:16' })).toEqual({
      meters: '12,5',
      capacity: '16',
      splitter: '1:16',
    });
    expect(attrsToFormStrings(undefined)).toEqual({});
  });
  it('formatNumber', () => expect(formatNumber(3)).toBe('3'));
});
