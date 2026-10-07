import { describe, expect, it } from 'vitest';
import { hashFor, parseLocation, parseRoute } from './route';

describe('parseRoute', () => {
  it('reconhece as telas', () => {
    expect(parseRoute('#/atividades')).toBe('atividades');
    expect(parseRoute('#/atividades/nova')).toBe('nova-atividade');
    expect(parseRoute('#/elemento/novo')).toBe('novo-elemento');
    expect(parseRoute('#/backup')).toBe('backup');
    expect(parseRoute('#/exportar')).toBe('exportar');
    expect(parseRoute('#/camadas')).toBe('camadas');
    expect(parseRoute('#/conta')).toBe('conta');
    expect(parseRoute('#/sincronizacao')).toBe('sincronizacao');
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

describe('parseLocation (atividade por id)', () => {
  it('lê o id da atividade, sem confundir com a lista', () => {
    expect(parseLocation('#/atividade/abc-1')).toEqual({ route: 'atividade', id: 'abc-1' });
    expect(parseRoute('#/atividades')).toBe('atividades');
    expect(parseRoute('#/atividades/nova')).toBe('nova-atividade');
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

describe('parseLocation (exportar)', () => {
  it('sem id exporta a rede; com id, uma atividade', () => {
    expect(parseLocation('#/exportar')).toEqual({ route: 'exportar' });
    expect(parseLocation('#/exportar/abc-1')).toEqual({ route: 'exportar', id: 'abc-1' });
    expect(parseLocation('#/exportar/a/b')).toEqual({ route: 'map' });
    expect(parseLocation('#/exportar/')).toEqual({ route: 'map' });
  });
});

describe('parseLocation (camadas de referência)', () => {
  it('camada e ponto de referência por id; o ":" do id composto vai codificado', () => {
    expect(parseLocation('#/camada/abc-1')).toEqual({ route: 'camada', id: 'abc-1' });
    expect(parseLocation('#/camada/')).toEqual({ route: 'map' });
    expect(parseLocation('#/referencia/abc-1%3A12')).toEqual({ route: 'referencia', id: 'abc-1:12' });
    expect(parseLocation('#/referencia/a/b')).toEqual({ route: 'map' });
  });
  it('navegar monta o mesmo endereço', () => {
    const id = encodeURIComponent('abc-1:12');
    expect(`#/referencia/${id}`).toBe('#/referencia/abc-1%3A12');
  });
});

describe('hashFor (ida e volta)', () => {
  it('o painel com secao vira #/painel/<secao> e volta igual; sem secao e #/painel', () => {
    expect(hashFor('painel')).toBe('#/painel');
    expect(hashFor('painel', 'mapa')).toBe('#/painel/mapa');
    expect(parseLocation(hashFor('painel', 'mapa'))).toEqual({ route: 'painel', id: 'mapa' });
    expect(parseLocation(hashFor('painel'))).toEqual({ route: 'painel' });
  });
});
