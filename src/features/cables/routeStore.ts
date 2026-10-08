import { useSyncExternalStore } from 'react';

// Qual cabo foi tocado no mapa: a rota dele acende e a folha com o resumo abre. Só existe enquanto o app está aberto.

let selected: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const routeStore = {
  get: (): string | null => selected,
  select(cableId: string) {
    if (selected === cableId) return;
    selected = cableId;
    emit();
  },
  clear() {
    if (selected === null) return;
    selected = null;
    emit();
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  },
};

/** O cabo cuja rota está acesa (null = nenhum). */
export const useSelectedRoute = (): string | null => useSyncExternalStore(routeStore.subscribe, routeStore.get, () => null);
