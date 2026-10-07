import { describe, expect, it } from 'vitest';
import { createPanelTotalsStore } from './panelTotalsStore';
import { DEFAULT_TOTALS_FILTERS } from './totals';

describe('panelTotalsStore', () => {
  it('comeca sem filtros; setFilters junta com o que ja esta; reset volta ao padrao e avisa quem acompanha', () => {
    const s = createPanelTotalsStore();
    expect(s.getFilters()).toBe(DEFAULT_TOTALS_FILTERS);
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.setFilters({ owner: 'u1' });
    s.setFilters({ from: '2026-10-01' });
    expect(s.getFilters()).toEqual({ owner: 'u1', kind: 'todas', from: '2026-10-01', to: '' });
    s.resetFilters();
    expect(s.getFilters()).toBe(DEFAULT_TOTALS_FILTERS);
    expect(calls).toBe(3);
    off();
    s.setFilters({ kind: 'manutencao' });
    expect(calls).toBe(3);
  });
});
