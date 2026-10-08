import { useSyncExternalStore } from 'react';
import type { BaseLayerId } from '../map/layers';
import type { Bounds } from '../map/mapCommands';
import { planBounds } from '../projects/plan';
import type { PlannedProject } from '../projects/planInfo';
import { DEFAULT_MAP_FILTERS, type MapFilters } from './mapFilters';

// O estado do mapa do painel (filtros, item aberto, ultima vista) fica fora da tela: abrir a ficha de um elemento e voltar
// nao pode zerar o que o escritorio estava olhando. Vive so enquanto a pagina estiver aberta.

export interface Selection {
  kind: 'elemento' | 'cabo' | 'atividade';
  id: string;
}

export interface SavedView {
  lat: number;
  lng: number;
  zoom: number;
}

export interface PanelMapState {
  filters: MapFilters;
  selection: Selection | null;
  view: SavedView | null;
  base: BaseLayerId;
  /** Pedido de "ir ate este item" (resultado da busca); `seq` muda a cada pedido, mesmo para o mesmo item. */
  focus: (Selection & { seq: number }) | null;
  /** Ultimo pedido de enquadramento que o mapa ja atendeu (o pedido pode vir de outra secao, antes de o mapa existir). */
  focusApplied: number;
  /** Pedido de enquadrar uma area (ex.: a trilha que acabou de chegar). Mesmo esquema de `focus`. */
  fitTo: { bounds: Bounds; seq: number } | null;
  fitApplied: number;
  /** O ponto de um projeto que o escritorio pediu para ver ("Ver no mapa" da ficha do projeto). */
  projectPin: { lat: number; lng: number; title: string } | null;
  /** O desenho de um projeto que o escritorio pediu para ver ("Ver o desenho no mapa" da ficha). */
  projectPlan: PlannedProject | null;
}

export function createPanelMapStore() {
  let state: PanelMapState = { filters: DEFAULT_MAP_FILTERS, selection: null, view: null, base: 'ruas', focus: null, focusApplied: 0, fitTo: null, fitApplied: 0, projectPin: null, projectPlan: null };
  let seq = 0;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<PanelMapState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  return {
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setFilters: (patch: Partial<MapFilters>) => set({ filters: { ...state.filters, ...patch } }),
    resetFilters: () => set({ filters: DEFAULT_MAP_FILTERS }),
    select: (selection: Selection | null) => set({ selection }),
    /** Abre o item e pede ao mapa para enquadra-lo. */
    focus: (s: Selection) => set({ selection: s, focus: { ...s, seq: ++seq } }),
    setView: (view: SavedView) => set({ view }),
    markFocusApplied: (seq: number) => set({ focusApplied: Math.max(state.focusApplied, seq) }),
    requestFit: (bounds: Bounds) => set({ fitTo: { bounds, seq: ++seq } }),
    markFitApplied: (n: number) => set({ fitApplied: Math.max(state.fitApplied, n) }),
    setBase: (base: BaseLayerId) => set({ base }),
    /** Marca o ponto de um projeto no mapa e pede para enquadra-lo. */
    showProjectPoint: (pin: { lat: number; lng: number; title: string }) => set({ projectPin: pin, fitTo: { bounds: [pin.lat, pin.lng, pin.lat, pin.lng], seq: ++seq } }),
    clearProjectPin: () => set({ projectPin: null }),
    /** Mostra o desenho do projeto no mapa e pede para enquadra-lo. Desenho vazio nao faz nada. */
    showProjectPlan: (planned: PlannedProject) => {
      const bounds = planBounds(planned.plan);
      if (bounds) set({ projectPlan: planned, fitTo: { bounds, seq: ++seq } });
    },
    clearProjectPlan: () => set({ projectPlan: null }),
  };
}

export const panelMapStore = createPanelMapStore();

export function usePanelMap<T>(selector: (s: PanelMapState) => T): T {
  return useSyncExternalStore(
    panelMapStore.subscribe,
    () => selector(panelMapStore.getState()),
    () => selector(panelMapStore.getState()),
  );
}
