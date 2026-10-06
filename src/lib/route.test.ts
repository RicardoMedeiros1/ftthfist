import { describe, expect, it } from 'vitest';
import { parseLocation, parseRoute } from './route';

describe('parseRoute', () => {
  it('reconhece as telas', () => {
    expect(parseRoute('#/atividades')).toBe('atividades');
    expect(parseRoute('#/atividades/nova')).toBe('nova-atividade');
    expect(parseRoute('#/elemento/novo')).toBe('novo-elemento');
    expect(parseRoute('#/backup')).toBe('backup');
    expect(parseRoute('#/cabo/novo')).toBe('novo-cabo');
    expect(parseRoute('#/trilha')).toBe('trilha');
    expect(parseRoute('#/config')).toBe('config');
  });
  it('qualquer outra coisa abre o mapa', () => {
    expect(parseRoute('')).toBe('map');
    expect(parseRoute('#/')).toBe('map');
    expect(parseRoute('#/inexistente')).toBe('map');
  });
});

describe('parseLocation (elemento por id)', () => {
  it('lê o id do elemento', () => {
    expect(parseLocation('#/elemento/abc-123')).toEqual({ route: 'elemento', id: 'abc-123' });
    expect(parseRoute('#/elemento/abc-123')).toBe('elemento');
  });
  it('"novo" continua sendo o formulário, não um id', () => {
    expect(parseLocation('#/elemento/novo')).toEqual({ route: 'novo-elemento' });
  });
  it('decodifica o id e ignora caminhos inválidos', () => {
    expect(parseLocation('#/elemento/a%20b').id).toBe('a b');
    expect(parseLocation('#/elemento/%E0%A4%A')).toEqual({ route: 'map' });
    expect(parseLocation('#/elemento/a/b')).toEqual({ route: 'map' });
    expect(parseLocation('#/elemento/')).toEqual({ route: 'map' });
  });
});

describe('parseLocation (cabo por id)', () => {
  it('lê o id do cabo; "novo" é a tela de lançar', () => {
    expect(parseLocation('#/cabo/abc-1')).toEqual({ route: 'cabo', id: 'abc-1' });
    expect(parseLocation('#/cabo/novo')).toEqual({ route: 'novo-cabo' });
    expect(parseLocation('#/cabo/a/b')).toEqual({ route: 'map' });
    expect(parseLocation('#/cabo/')).toEqual({ route: 'map' });
  });
});
