import { describe, expect, it } from 'vitest';
import { mergeNames, missingNames, resolveNames } from './peopleNames';

const A = (ownerId: string | undefined, technician: string, startedAt: number, deleted = false) => ({ ownerId, technician, startedAt, deleted });

describe('missingNames', () => {
  it('so quem nao tem nome no cadastro guardado, sem repetir', () => {
    expect(missingNames(['a', 'b', 'a', 'c'], { a: 'Ana', c: '   ' })).toEqual(['b', 'c']);
    expect(missingNames([], {})).toEqual([]);
  });
});

describe('mergeNames', () => {
  it('junta, atualiza e nunca apaga um nome bom com um vazio', () => {
    expect(mergeNames({ a: 'Ana' }, new Map([['b', ' Bia '], ['a', '']]))).toEqual({ a: 'Ana', b: 'Bia' });
    expect(mergeNames({ a: 'Ana' }, new Map([['a', 'Ana Souza']]))).toEqual({ a: 'Ana Souza' });
  });
  it('nao altera o que ja estava guardado', () => {
    const cache = { a: 'Ana' };
    mergeNames(cache, new Map([['b', 'Bia']]));
    expect(cache).toEqual({ a: 'Ana' });
  });
});

describe('resolveNames', () => {
  it('o nome do cadastro vale primeiro', () => {
    expect(resolveNames(['a'], { a: 'Ana Souza' }, [A('a', 'ana digitado', 1)]).get('a')).toBe('Ana Souza');
  });
  it('sem cadastro, o nome da atividade mais recente da pessoa', () => {
    const acts = [A('a', 'Ana Antiga', 100), A('a', 'Ana Nova', 300), A('a', 'Ana Meio', 200), A('b', 'Bia', 50)];
    expect(resolveNames(['a', 'b'], {}, acts)).toEqual(new Map([['a', 'Ana Nova'], ['b', 'Bia']]));
  });
  it('ignora atividade excluida, sem dono ou sem nome; quem nao tem nome fica de fora', () => {
    const acts = [A('a', 'Apagada', 900, true), A(undefined, 'Sem dono', 800), A('a', '   ', 700), A('a', 'Boa', 10)];
    expect(resolveNames(['a', 'z'], { z: '  ' }, acts)).toEqual(new Map([['a', 'Boa']]));
  });
  it('so devolve quem foi pedido', () => {
    expect(resolveNames(['a'], { a: 'Ana', b: 'Bia' }, [A('c', 'Caio', 1)])).toEqual(new Map([['a', 'Ana']]));
  });
});
