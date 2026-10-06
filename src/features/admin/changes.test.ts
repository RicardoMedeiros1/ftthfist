import { describe, expect, it } from 'vitest';
import type { ChangeEntry } from './adminApi';
import { describeChange, ids } from './changes';

const entry = (over: Partial<ChangeEntry> = {}): ChangeEntry => ({
  id: 7, at: '2026-10-06T15:00:00Z', table: 'elements', recordId: 'el-1', ownerId: 'ana', editedBy: 'davi',
  before: { type: 'poste', code: 'P-1', deleted: false }, after: { type: 'poste', code: 'P-2', deleted: false }, ...over,
});
const names = new Map([['ana', 'Ana'], ['davi', 'Davi']]);

describe('describeChange', () => {
  it('alteracao: quem alterou, de quem era o registro, o que mudou e como abrir', () => {
    const v = describeChange('alteracao', entry(), names);
    expect(v.headline).toBe('Davi alterou · Poste P-2');
    expect(v.owner).toBe('de Ana');
    expect(v.changes).toEqual([{ label: 'Identificação', before: 'P-1', after: 'P-2' }]);
    expect(v.open).toEqual({ route: 'elemento', id: 'el-1' });
    expect(v.key).toBe('a7');
  });

  it('exclusao diz "excluiu" e nao oferece abrir (o registro some do app)', () => {
    const v = describeChange('alteracao', entry({ after: { type: 'poste', code: 'P-1', deleted: true } }), names);
    expect(v.headline).toBe('Davi excluiu · Poste P-1');
    expect(v.open).toBeNull();
  });

  it('conflito: mostra o que ficou e o que chegou atrasado', () => {
    const v = describeChange('conflito', entry({ editedBy: null, before: { code: 'NOVO' }, after: { code: 'ATRASADO' } }), names);
    expect(v.headline).toMatch(/^Edição atrasada recusada/);
    expect(v.changes).toEqual([{ label: 'Identificação', before: 'ficou NOVO', after: 'chegou ATRASADO' }]);
    expect(v.key).toBe('c7');
  });

  it('pessoa sem nome no cadastro vira "Alguém" (nunca "undefined")', () => {
    const v = describeChange('alteracao', entry({ ownerId: 'x', editedBy: 'y' }), new Map());
    expect(v.headline.startsWith('Alguém alterou')).toBe(true);
    expect(v.owner).toBe('de Alguém');
  });

  it('foto e ponto da trilha nao tem tela para abrir', () => {
    expect(describeChange('alteracao', entry({ table: 'photos' }), names).open).toBeNull();
    expect(describeChange('alteracao', entry({ table: 'cables' }), names).open).toEqual({ route: 'cabo', id: 'el-1' });
    expect(describeChange('alteracao', entry({ table: 'activities' }), names).open).toEqual({ route: 'atividade', id: 'el-1' });
  });
});

describe('ids', () => {
  it('dono e quem alterou, de todas as linhas (para buscar os nomes de uma vez)', () => {
    expect(ids([entry(), entry({ ownerId: 'bruno', editedBy: null })])).toEqual(['ana', 'davi', 'bruno']);
  });
});
