import { useSyncExternalStore } from 'react';
import { SETTING_KEYS, db, getSetting } from '../../db/db';
import { pathLengthMeters, round2 } from '../../lib/geo';

// Cabo em lançamento (antes de finalizar). Fica salvo no aparelho a cada mudança: se o app recarregar ou
// a bateria acabar no meio do trabalho, o lançamento é retomado de onde parou.

export interface DraftVertex {
  elementId?: string;
  lat: number;
  lng: number;
}

/** Cada ação do técnico, na ordem, para o "Desfazer" desfazer exatamente a última coisa que ele fez. */
export type DraftAction =
  | { kind: 'vertex'; /** poste criado por "Marcar poste aqui e ligar" (sai junto se desfeito) */ createdElementId?: string }
  | { kind: 'reserve'; elementId: string; meters: number };

export interface CableDraft {
  /** Id que o cabo terá ao ser salvo; as reservas já apontam para ele. */
  cableId: string;
  cableType: string;
  fiberCount: number;
  vertices: DraftVertex[];
  actions: DraftAction[];
  startedAt: number;
}

let state: CableDraft | null = null;
const listeners = new Set<() => void>();
const KEY = SETTING_KEYS.cableDraft;

function commit(next: CableDraft | null) {
  state = next;
  listeners.forEach((l) => l());
  // Gravação assíncrona e sem bloquear a tela; falhar aqui não pode derrubar o lançamento.
  const write: Promise<unknown> = next ? db.settings.put({ key: KEY, value: next }) : db.settings.delete(KEY);
  void write.catch(() => undefined);
}

const sameSpot = (a: DraftVertex, b: DraftVertex) =>
  (a.elementId !== undefined && a.elementId === b.elementId) || (a.lat === b.lat && a.lng === b.lng);

export const cableDraftStore = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  begin(cfg: { cableType: string; fiberCount: number }) {
    commit({
      cableId: crypto.randomUUID(),
      cableType: cfg.cableType,
      fiberCount: cfg.fiberCount,
      vertices: [],
      actions: [],
      startedAt: Date.now(),
    });
  },

  /** Adiciona um ponto ao fim. Devolve false (e ignora) se for o mesmo ponto do último. */
  addVertex(v: DraftVertex, createdElementId?: string): boolean {
    if (!state) return false;
    const last = state.vertices[state.vertices.length - 1];
    if (last && sameSpot(last, v)) return false;
    commit({
      ...state,
      vertices: [...state.vertices, v],
      actions: [...state.actions, createdElementId ? { kind: 'vertex', createdElementId } : { kind: 'vertex' }],
    });
    return true;
  },

  addReserve(elementId: string, meters: number) {
    if (!state) return;
    commit({ ...state, actions: [...state.actions, { kind: 'reserve', elementId, meters }] });
  },

  /** Desfaz a última ação e devolve qual foi (quem chama apaga o poste/reserva que ela tinha criado). */
  undo(): DraftAction | null {
    if (!state || state.actions.length === 0) return null;
    const last = state.actions[state.actions.length - 1]!;
    commit({
      ...state,
      vertices: last.kind === 'vertex' ? state.vertices.slice(0, -1) : state.vertices,
      actions: state.actions.slice(0, -1),
    });
    return last;
  },

  clear: () => commit(null),

  /** Ao abrir o app: retoma um lançamento interrompido, se houver e estiver íntegro. */
  async hydrate(): Promise<boolean> {
    const saved = await getSetting<unknown>(KEY, null);
    const d = saved as CableDraft | null;
    const ok =
      d !== null &&
      typeof d === 'object' &&
      typeof d.cableId === 'string' &&
      typeof d.cableType === 'string' &&
      typeof d.fiberCount === 'number' &&
      Array.isArray(d.vertices) &&
      Array.isArray(d.actions);
    if (!ok) return false;
    state = d;
    listeners.forEach((l) => l());
    return true;
  },
};

// ---- derivados ----

export const draftLengthMeters = (d: CableDraft) => round2(pathLengthMeters(d.vertices));
export const draftReserveMeters = (d: CableDraft) =>
  round2(d.actions.reduce((sum, a) => sum + (a.kind === 'reserve' ? a.meters : 0), 0));
export const canFinishDraft = (d: CableDraft) => d.vertices.length >= 2;

export function useCableDraft<T>(selector: (d: CableDraft | null) => T): T {
  return useSyncExternalStore(cableDraftStore.subscribe, () => selector(state), () => selector(null));
}
