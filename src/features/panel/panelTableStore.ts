import { useSyncExternalStore } from 'react';
import { DEFAULT_ROW_FILTERS, DEFAULT_SORT, nextSort, type RowFilters, type Sort, type SortKey } from './activityRows';

// O estado da tabela de atividades (filtros, ordem, quantas linhas, linha aberta) fica fora da tela, como o do mapa:
// abrir uma ficha completa e voltar nao zera o que o escritorio estava olhando.

export const ROWS_PAGE = 100;

export interface PanelTableState {
  filters: RowFilters;
  sort: Sort;
  /** Quantas linhas aparecem (cresce de 100 em 100 com "Mostrar mais"). */
  visible: number;
  selectedId: string | null;
}

export function createPanelTableStore() {
  let state: PanelTableState = { filters: DEFAULT_ROW_FILTERS, sort: DEFAULT_SORT, visible: ROWS_PAGE, selectedId: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<PanelTableState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  return {
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    /** Mudar um filtro volta para a primeira pagina. */
    setFilters: (patch: Partial<RowFilters>) => set({ filters: { ...state.filters, ...patch }, visible: ROWS_PAGE }),
    resetFilters: () => set({ filters: DEFAULT_ROW_FILTERS, visible: ROWS_PAGE }),
    toggleSort: (key: SortKey) => set({ sort: nextSort(state.sort, key), visible: ROWS_PAGE }),
    showMore: () => set({ visible: state.visible + ROWS_PAGE }),
    select: (selectedId: string | null) => set({ selectedId }),
  };
}

export const panelTableStore = createPanelTableStore();

export function usePanelTable<T>(selector: (s: PanelTableState) => T): T {
  return useSyncExternalStore(
    panelTableStore.subscribe,
    () => selector(panelTableStore.getState()),
    () => selector(panelTableStore.getState()),
  );
}
