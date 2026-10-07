import { useSyncExternalStore } from 'react';
import { DEFAULT_PROJECT_FILTERS, nextProjectSort, type ProjectFilters, type ProjectSort, type ProjectSortKey } from './projectTable';

// O estado da tabela de projetos (filtros, ordem, quantas linhas, linha aberta) fica fora da tela, como o das atividades:
// abrir uma atividade ou o mapa e voltar nao zera o que o escritorio estava olhando.

export const PROJECT_ROWS_PAGE = 100;

export interface PanelProjectsState {
  filters: ProjectFilters;
  /** null = ordem padrao (os que pedem atencao primeiro). */
  sort: ProjectSort | null;
  visible: number;
  selectedId: string | null;
}

export function createPanelProjectsStore() {
  let state: PanelProjectsState = { filters: DEFAULT_PROJECT_FILTERS, sort: null, visible: PROJECT_ROWS_PAGE, selectedId: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<PanelProjectsState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  return {
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setFilters: (patch: Partial<ProjectFilters>) => set({ filters: { ...state.filters, ...patch }, visible: PROJECT_ROWS_PAGE }),
    resetFilters: () => set({ filters: DEFAULT_PROJECT_FILTERS, visible: PROJECT_ROWS_PAGE }),
    toggleSort: (key: ProjectSortKey) => set({ sort: nextProjectSort(state.sort, key), visible: PROJECT_ROWS_PAGE }),
    showMore: () => set({ visible: state.visible + PROJECT_ROWS_PAGE }),
    select: (selectedId: string | null) => set({ selectedId }),
  };
}

export const panelProjectsStore = createPanelProjectsStore();

export function usePanelProjects<T>(selector: (s: PanelProjectsState) => T): T {
  return useSyncExternalStore(
    panelProjectsStore.subscribe,
    () => selector(panelProjectsStore.getState()),
    () => selector(panelProjectsStore.getState()),
  );
}
