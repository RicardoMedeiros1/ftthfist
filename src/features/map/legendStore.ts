import { useSyncExternalStore } from 'react';

// Legenda dos cabos aberta sobre o mapa. Fica fora do MapScreen para a barra de abas (que mora no App) se esconder junto.

let open = false;
const listeners = new Set<() => void>();

export const legendStore = {
  get: (): boolean => open,
  set(next: boolean) {
    if (open === next) return;
    open = next;
    listeners.forEach((l) => l());
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  },
};

export const useLegendOpen = (): boolean => useSyncExternalStore(legendStore.subscribe, legendStore.get, () => false);
