import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_FILTERS } from './mapFilters';
import { createPanelMapStore } from './panelMapStore';

describe('panelMapStore', () => {
  it('comeca sem filtros, sem selecao e em "Ruas"', () => {
    expect(createPanelMapStore().getState()).toEqual({ filters: DEFAULT_MAP_FILTERS, selection: null, view: null, base: 'ruas', focus: null, focusApplied: 0, fitTo: null, fitApplied: 0, projectPin: null });
  });

  it('setFilters junta com o que ja esta e resetFilters volta ao padrao', () => {
    const s = createPanelMapStore();
    s.setFilters({ owner: 'u1' });
    s.setFilters({ query: 'P-001' });
    expect(s.getState().filters).toMatchObject({ owner: 'u1', query: 'P-001', kind: 'todas' });
    s.resetFilters();
    expect(s.getState().filters).toBe(DEFAULT_MAP_FILTERS);
  });

  it('focus abre o item E pede o enquadramento; pedir o mesmo item de novo gera um pedido novo', () => {
    const s = createPanelMapStore();
    s.focus({ kind: 'elemento', id: 'e1' });
    const first = s.getState().focus!;
    expect(s.getState().selection).toEqual({ kind: 'elemento', id: 'e1' });
    s.focus({ kind: 'elemento', id: 'e1' });
    expect(s.getState().focus!.seq).toBeGreaterThan(first.seq);
  });

  it('pedido de enquadramento feito antes de o mapa existir continua valendo ate o mapa atender', () => {
    const s = createPanelMapStore();
    s.focus({ kind: 'atividade', id: 'a1' }); // veio da tabela, o mapa ainda nao esta na tela
    const { focus, focusApplied } = s.getState();
    expect(focus!.seq).toBeGreaterThan(focusApplied);
    s.markFocusApplied(focus!.seq);
    expect(s.getState().focusApplied).toBe(focus!.seq);
    s.markFocusApplied(0); // um valor velho nao volta atras
    expect(s.getState().focusApplied).toBe(focus!.seq);
    s.focus({ kind: 'atividade', id: 'a1' });
    expect(s.getState().focus!.seq).toBeGreaterThan(s.getState().focusApplied);
  });

  it('pedido para enquadrar uma area: vale ate o mapa atender, e cada pedido e novo', () => {
    const s = createPanelMapStore();
    s.requestFit([1, 2, 3, 4]);
    const first = s.getState().fitTo!;
    expect(first).toMatchObject({ bounds: [1, 2, 3, 4] });
    expect(first.seq).toBeGreaterThan(s.getState().fitApplied);
    s.markFitApplied(first.seq);
    s.markFitApplied(0);
    expect(s.getState().fitApplied).toBe(first.seq);
    s.requestFit([1, 2, 3, 4]);
    expect(s.getState().fitTo!.seq).toBeGreaterThan(first.seq);
    expect(s.getState().focus).toBeNull(); // nao abre ficha nenhuma
  });

  it('select (clique no mapa) abre o item sem pedir enquadramento', () => {
    const s = createPanelMapStore();
    s.select({ kind: 'cabo', id: 'c1' });
    expect(s.getState().selection).toEqual({ kind: 'cabo', id: 'c1' });
    expect(s.getState().focus).toBeNull();
    s.select(null);
    expect(s.getState().selection).toBeNull();
  });

  it('avisa quem acompanha a cada mudanca e deixa de avisar ao cancelar', () => {
    const s = createPanelMapStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.setBase('satelite');
    s.setView({ lat: 1, lng: 2, zoom: 3 });
    expect(calls).toBe(2);
    off();
    s.setBase('ruas');
    expect(calls).toBe(2);
    expect(s.getState()).toMatchObject({ base: 'ruas', view: { lat: 1, lng: 2, zoom: 3 } });
  });
});

describe('ponto de um projeto no mapa do painel', () => {
  it('marca o ponto e pede para enquadrar exatamente nele (limites iguais = ponto so)', () => {
    const s = createPanelMapStore();
    s.showProjectPoint({ lat: -23.55, lng: -46.63, title: 'Rua das Flores' });
    const { projectPin, fitTo } = s.getState();
    expect(projectPin).toEqual({ lat: -23.55, lng: -46.63, title: 'Rua das Flores' });
    expect(fitTo!.bounds).toEqual([-23.55, -46.63, -23.55, -46.63]);
  });
  it('pedir de novo (mesmo ponto) gera um pedido novo; tirar a marca nao mexe no resto', () => {
    const s = createPanelMapStore();
    s.showProjectPoint({ lat: 1, lng: 2, title: 'A' });
    const first = s.getState().fitTo!.seq;
    s.showProjectPoint({ lat: 1, lng: 2, title: 'A' });
    expect(s.getState().fitTo!.seq).toBeGreaterThan(first);
    s.select({ kind: 'elemento', id: 'e1' });
    s.clearProjectPin();
    expect(s.getState().projectPin).toBeNull();
    expect(s.getState().selection).toEqual({ kind: 'elemento', id: 'e1' });
    expect(s.getState().fitTo).not.toBeNull();
  });
  it('tambem avisa quem acompanha', () => {
    const s = createPanelMapStore();
    let n = 0;
    s.subscribe(() => n++);
    s.showProjectPoint({ lat: 1, lng: 2, title: 'A' });
    s.clearProjectPin();
    expect(n).toBe(2);
  });
});
