import { useSyncExternalStore } from 'react';

// Diálogo "metros de reserva" do lançamento: o botão fica entre os botões do mapa e o diálogo no painel de lançamento.

let open = false;
const listeners = new Set<() => void>();

export const reserveUi = {
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

export const useReserveOpen = (): boolean => useSyncExternalStore(reserveUi.subscribe, reserveUi.get, () => false);
