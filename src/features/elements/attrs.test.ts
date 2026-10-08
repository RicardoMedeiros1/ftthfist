import { describe, expect, it } from 'vitest';
import { sanitizeAttrs } from './attrs';

describe('sanitizeAttrs', () => {
  it('poste: dono válido e plaqueta; descarta dono inválido', () => {
    expect(sanitizeAttrs('poste', { owner: 'concessionaria', ownerCode: ' 123-A ' })).toEqual({
      owner: 'concessionaria',
      ownerCode: '123-A',
    });
    expect(sanitizeAttrs('poste', { owner: 'invasor' })).toEqual({});
  });

  it('cto: cabo e fibra de entrada valem juntos; pela metade, nenhum dos dois', () => {
    const C = '00000000-0000-4000-8000-0000000000c1';
    expect(sanitizeAttrs('cto', { feedCableId: C, feedFiber: '7' })).toEqual({ feedCableId: C, feedFiber: 7 });
    expect(sanitizeAttrs('cto', { feedCableId: C, feedFiber: 7 })).toEqual({ feedCableId: C, feedFiber: 7 });
    expect(sanitizeAttrs('cto', { feedCableId: C, feedFiber: '' })).toEqual({});
    expect(sanitizeAttrs('cto', { feedCableId: C })).toEqual({});
    expect(sanitizeAttrs('cto', { feedFiber: '3' })).toEqual({});
    expect(sanitizeAttrs('cto', { feedCableId: C, feedFiber: '0' })).toEqual({});
    expect(sanitizeAttrs('cto', { feedCableId: C, feedFiber: '-1' })).toEqual({});
    expect(sanitizeAttrs('cto', { feedCableId: 'abc', feedFiber: '3' })).toEqual({});
    expect(sanitizeAttrs('cto', { capacity: '8', feedCableId: C, feedFiber: '12' })).toEqual({ capacity: 8, feedCableId: C, feedFiber: 12 });
  });
  it('só a CTO guarda a fibra de entrada', () => {
    const C = '00000000-0000-4000-8000-0000000000c1';
    for (const t of ['poste', 'ceo', 'reserva', 'ocorrencia', 'outro'] as const) expect(sanitizeAttrs(t, { feedCableId: C, feedFiber: 3 })).not.toHaveProperty('feedFiber');
  });
  it('cto: converte texto em inteiro e valida o splitter', () => {
    expect(sanitizeAttrs('cto', { capacity: '16', splitter: '1:16' })).toEqual({ capacity: 16, splitter: '1:16' });
    expect(sanitizeAttrs('cto', { capacity: '7,6', splitter: 'abc' })).toEqual({ capacity: 8 });
  });

  it('números vazios, negativos ou inválidos somem (vazio não vira zero)', () => {
    expect(sanitizeAttrs('ceo', { trays: '', splices: '-3' })).toEqual({});
    expect(sanitizeAttrs('ceo', { trays: 'abc', splices: '12' })).toEqual({ splices: 12 });
  });

  it('reserva: metros aceitam vírgula decimal e guarda o cabo ao qual pertence', () => {
    expect(sanitizeAttrs('reserva', { meters: '12,5', cableId: ' c-1 ' })).toEqual({ meters: 12.5, cableId: 'c-1' });
    expect(sanitizeAttrs('reserva', { meters: '3', cableId: '' })).toEqual({ meters: 3 });
  });

  it('ocorrência: problema da lista e ação tomada', () => {
    expect(sanitizeAttrs('ocorrencia', { problem: 'rompimento', actionTaken: ' fusão ' })).toEqual({
      problem: 'rompimento',
      actionTaken: 'fusão',
    });
    expect(sanitizeAttrs('ocorrencia', { problem: 'outra coisa' })).toEqual({});
  });

  it('descarta campos de outro tipo e tolera entrada inválida', () => {
    expect(sanitizeAttrs('poste', { trays: 4, meters: 2 })).toEqual({});
    expect(sanitizeAttrs('outro', { qualquer: 1 })).toEqual({});
    expect(sanitizeAttrs('cto', null)).toEqual({});
    expect(sanitizeAttrs('cto', 'texto')).toEqual({});
  });
});
