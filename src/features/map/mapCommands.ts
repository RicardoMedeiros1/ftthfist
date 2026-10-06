import { useSyncExternalStore } from 'react';

// Pedidos de outras telas para o mapa ("ver no mapa"). O mapa fica sempre montado atrás das telas,
// então o pedido espera aqui até o mapa existir e o aplica.

/** [sul, oeste, norte, leste] */
export type Bounds = [number, number, number, number];

export type MapCommand = { id: number; kind: 'fit'; bounds: Bounds } | { id: number; kind: 'center'; lat: number; lng: number; zoom: number };

let pending: MapCommand | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const mapCommands = {
  fitBounds(bounds: Bounds) {
    pending = { id: ++seq, kind: 'fit', bounds };
    emit();
  },
  center(lat: number, lng: number, zoom = 19) {
    pending = { id: ++seq, kind: 'center', lat, lng, zoom };
    emit();
  },
  /** Só apaga se ainda for o mesmo pedido (um pedido novo não pode ser descartado por engano). */
  done(id: number) {
    if (pending?.id === id) {
      pending = null;
      emit();
    }
  },
  peek: () => pending,
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export const usePendingMapCommand = () => useSyncExternalStore(mapCommands.subscribe, mapCommands.peek, () => null);
