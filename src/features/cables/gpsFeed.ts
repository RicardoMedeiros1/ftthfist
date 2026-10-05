import { useSyncExternalStore } from 'react';
import type { Fix } from '../elements/gpsCapture';

// Leituras recentes do GPS durante o lançamento do cabo. Mantém só os últimos segundos: o botão
// "Marcar poste aqui" escolhe a melhor entre elas em vez de esperar uma busca nova a cada poste.

export interface FeedFix extends Fix {
  /** Quando o app recebeu a leitura (relógio local), usado para saber quão recente ela é. */
  receivedAt: number;
}

const KEEP_MS = 15_000;
let fixes: FeedFix[] = [];
let latest: FeedFix | null = null;
const listeners = new Set<() => void>();

export const gpsFeed = {
  push(fix: Fix, now = Date.now()) {
    const f: FeedFix = { ...fix, receivedAt: now };
    fixes = [...fixes.filter((x) => now - x.receivedAt <= KEEP_MS), f];
    latest = f;
    listeners.forEach((l) => l());
  },
  /** Leituras recebidas a partir de `sinceMs` (relógio local). */
  recent: (sinceMs: number): FeedFix[] => fixes.filter((f) => f.receivedAt >= sinceMs),
  latest: () => latest,
  reset() {
    fixes = [];
    latest = null;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useLatestFix(): FeedFix | null {
  return useSyncExternalStore(gpsFeed.subscribe, () => latest, () => null);
}
