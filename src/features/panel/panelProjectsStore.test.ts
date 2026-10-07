import { describe, expect, it } from 'vitest';
import { PROJECT_ROWS_PAGE, createPanelProjectsStore } from './panelProjectsStore';
import { DEFAULT_PROJECT_FILTERS } from './projectTable';

describe('estado da tabela de projetos', () => {
  it('comeca com o que falta fazer, ordem padrao e nada aberto', () => {
    expect(createPanelProjectsStore().getState()).toEqual({ filters: DEFAULT_PROJECT_FILTERS, sort: null, visible: PROJECT_ROWS_PAGE, selectedId: null });
  });
  it('mudar filtro junta com os anteriores, volta para a primeira pagina e avisa quem acompanha', () => {
    const s = createPanelProjectsStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.showMore();
    expect(s.getState().visible).toBe(PROJECT_ROWS_PAGE * 2);
    s.setFilters({ query: 'flores' });
    s.setFilters({ onlyOverdue: true });
    expect(s.getState().filters).toEqual({ ...DEFAULT_PROJECT_FILTERS, query: 'flores', onlyOverdue: true });
    expect(s.getState().visible).toBe(PROJECT_ROWS_PAGE);
    expect(calls).toBe(3);
    off();
    s.select('p1');
    expect(calls).toBe(3); // quem saiu nao e mais avisado
  });
  it('limpar filtros nao mexe na ordem nem na linha aberta', () => {
    const s = createPanelProjectsStore();
    s.toggleSort('title');
    s.select('p1');
    s.setFilters({ query: 'x' });
    s.resetFilters();
    expect(s.getState()).toMatchObject({ filters: DEFAULT_PROJECT_FILTERS, sort: { key: 'title', dir: 'asc' }, selectedId: 'p1' });
  });
  it('clicar na coluna ordena, inverte e volta ao padrao; mostra mais cresce de pagina em pagina', () => {
    const s = createPanelProjectsStore();
    s.toggleSort('meters');
    s.toggleSort('meters');
    s.toggleSort('meters');
    expect(s.getState().sort).toBeNull();
    s.showMore();
    s.showMore();
    expect(s.getState().visible).toBe(PROJECT_ROWS_PAGE * 3);
    s.toggleSort('title');
    expect(s.getState().visible).toBe(PROJECT_ROWS_PAGE);
  });
});
