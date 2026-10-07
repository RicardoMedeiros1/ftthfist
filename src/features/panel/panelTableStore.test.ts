import { describe, expect, it } from 'vitest';
import { DEFAULT_ROW_FILTERS, DEFAULT_SORT } from './activityRows';
import { ROWS_PAGE, createPanelTableStore } from './panelTableStore';

describe('panelTableStore', () => {
  it('comeca sem filtros, ordenado pelo inicio mais recente, 100 linhas e nada aberto', () => {
    expect(createPanelTableStore().getState()).toEqual({ filters: DEFAULT_ROW_FILTERS, sort: DEFAULT_SORT, visible: ROWS_PAGE, selectedId: null });
    expect(ROWS_PAGE).toBe(100);
  });

  it('mudar filtro ou ordem volta para a primeira pagina; "mostrar mais" soma uma pagina', () => {
    const s = createPanelTableStore();
    s.showMore();
    s.showMore();
    expect(s.getState().visible).toBe(300);
    s.setFilters({ owner: 'u1' });
    expect(s.getState().visible).toBe(100);
    s.showMore();
    s.toggleSort('title');
    expect(s.getState()).toMatchObject({ visible: 100, sort: { key: 'title', dir: 'asc' } });
    s.showMore();
    s.resetFilters();
    expect(s.getState().visible).toBe(100);
    expect(s.getState().filters).toBe(DEFAULT_ROW_FILTERS);
  });

  it('setFilters junta com o que ja esta; toggleSort alterna o sentido na mesma coluna', () => {
    const s = createPanelTableStore();
    s.setFilters({ owner: 'u1' });
    s.setFilters({ query: 'P-1' });
    expect(s.getState().filters).toMatchObject({ owner: 'u1', query: 'P-1', kind: 'todas' });
    s.toggleSort('meters');
    expect(s.getState().sort).toEqual({ key: 'meters', dir: 'desc' });
    s.toggleSort('meters');
    expect(s.getState().sort).toEqual({ key: 'meters', dir: 'asc' });
  });

  it('abrir e fechar a ficha nao mexe na lista; avisa quem acompanha', () => {
    const s = createPanelTableStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.select('a1');
    s.select(null);
    expect(calls).toBe(2);
    expect(s.getState()).toMatchObject({ selectedId: null, visible: 100 });
    off();
    s.select('a2');
    expect(calls).toBe(2);
  });
});
