import { describe, expect, it } from 'vitest';
import { parseLocation, parseRoute } from '../../lib/route';
import { PANEL_SECTIONS, sectionOf } from './sections';

describe('sectionOf', () => {
  it('sem secao ou com secao desconhecida abre a visao geral', () => {
    expect(sectionOf(undefined).id).toBe('visao-geral');
    expect(sectionOf('inexistente').id).toBe('visao-geral');
    expect(sectionOf('toString').id).toBe('visao-geral'); // chave herdada de Object nao e secao
  });
  it('acha cada secao do proprio painel pelo id; atalho para outra tela cai na visao geral', () => {
    for (const s of PANEL_SECTIONS) expect(sectionOf(s.id)).toBe(s.kind === 'aqui' ? s : PANEL_SECTIONS[0]);
    expect(sectionOf('exportar').id).toBe('visao-geral');
    expect(sectionOf('totais').id).toBe('totais');
  });
  it('ids sao unicos e as telas existentes apontam para rotas reais', () => {
    expect(new Set(PANEL_SECTIONS.map((s) => s.id)).size).toBe(PANEL_SECTIONS.length);
    for (const s of PANEL_SECTIONS) if (s.kind === 'tela') expect(parseRoute(`#/${s.route}`)).toBe(s.route);
  });
});

describe('rotas do painel', () => {
  it('#/painel e #/painel/<secao>', () => {
    expect(parseLocation('#/painel')).toEqual({ route: 'painel' });
    expect(parseLocation('#/painel/mapa')).toEqual({ route: 'painel', id: 'mapa' });
    expect(parseRoute('#/painel/totais')).toBe('painel');
  });
});
