import { useSyncExternalStore } from 'react';
import { DEFAULT_TOTALS_FILTERS, type TotalsFilters } from './totals';

// Filtros da secao Totais: ficam fora da tela (como o mapa e a tabela) para nao zerar ao abrir outra tela e voltar.

export function createPanelTotalsStore() {
  let filters: TotalsFilters = DEFAULT_TOTALS_FILTERS;
  const listeners = new Set<() => void>();
  const set = (f: TotalsFilters) => {
    filters = f;
    listeners.forEach((l) => l());
  };
  return {
    getFilters: () => filters,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setFilters: (patch: Partial<TotalsFilters>) => set({ ...filters, ...patch }),
    resetFilters: () => set(DEFAULT_TOTALS_FILTERS),
  };
}

export const panelTotalsStore = createPanelTotalsStore();
export const usePanelTotalsFilters = (): TotalsFilters => useSyncExternalStore(panelTotalsStore.subscribe, panelTotalsStore.getFilters, panelTotalsStore.getFilters);
