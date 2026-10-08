import { useSyncExternalStore } from 'react';
import { SETTING_KEYS, db, getSetting } from '../../db/db';
import type { ColorStandard } from '../../db/types';
import { pathLengthMeters, round2 } from '../../lib/geo';

// Lançamento em andamento (antes de finalizar): o tronco e, se o técnico derivou, os ramais. Fica salvo no aparelho a cada
// mudança: se o app recarregar ou a bateria acabar no meio do trabalho, o lançamento é retomado de onde parou.

export interface DraftVertex {
  elementId?: string;
  lat: number;
  lng: number;
}

/** Um cabo do lançamento: o tronco (o primeiro) ou um ramal derivado de outro cabo num elemento. */
export interface DraftCable {
  /** Id que o cabo terá ao ser salvo; as reservas já apontam para ele. */
  cableId: string;
  cableType: string;
  fiberCount: number;
  /** Cores das fibras (lançamento salvo antes desta versão não tem: vale ABNT). */
  colorStandard?: ColorStandard;
  vertices: DraftVertex[];
  /** Só nos ramais: o cabo de onde derivou. O elemento da derivação é o primeiro ponto do ramal. */
  parentId?: string;
}

/** Cada ação do técnico, na ordem, para o "Desfazer" desfazer exatamente a última coisa que ele fez. */
export type DraftAction =
  | { kind: 'vertex'; /** poste/CEO/CTO criado por "Marcar aqui e ligar" (sai junto se desfeito) */ createdElementId?: string }
  | { kind: 'reserve'; cableId: string; elementId: string; meters: number }
  /** Derivou: abriu o ramal `cableId` a partir do último ponto do cabo que estava ativo. */
  | { kind: 'branch'; cableId: string }
  /** Terminou o ramal `cableId` e voltou ao cabo de onde ele saiu. */
  | { kind: 'return'; cableId: string };

export interface CableDraft {
  /** O tronco é o primeiro; cada ramal vem depois do cabo de onde saiu. */
  cables: DraftCable[];
  actions: DraftAction[];
  startedAt: number;
}

/** Escolha de tipo e fibras de um cabo (o tronco ao começar, cada ramal ao derivar). */
export interface CableChoice {
  cableType: string;
  fiberCount: number;
  colorStandard?: ColorStandard;
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

function newCable(cfg: CableChoice, vertices: DraftVertex[] = [], parentId?: string): DraftCable {
  return {
    cableId: crypto.randomUUID(),
    cableType: cfg.cableType,
    fiberCount: cfg.fiberCount,
    ...(cfg.colorStandard ? { colorStandard: cfg.colorStandard } : {}),
    vertices,
    ...(parentId ? { parentId } : {}),
  };
}

// ---- cabo ativo ----

/**
 * Cabos abertos agora, do tronco ao ativo: derivar abre um ramal (entra na pilha) e terminar o ramal volta ao cabo de onde
 * ele saiu. Calculado das ações, então o que está gravado nunca fica contraditório.
 */
export function openStack(d: CableDraft): string[] {
  const stack = [d.cables[0]!.cableId];
  for (const a of d.actions) {
    if (a.kind === 'branch') stack.push(a.cableId);
    else if (a.kind === 'return' && stack.length > 1 && stack[stack.length - 1] === a.cableId) stack.pop();
  }
  return stack;
}

/** O cabo que recebe os pontos e reservas agora. */
export function activeCable(d: CableDraft): DraftCable {
  const id = openStack(d).at(-1);
  return d.cables.find((c) => c.cableId === id) ?? d.cables[0]!;
}

/** O último ponto lançado num cabo (onde o técnico está agora). */
export const lastVertex = (c: DraftCable): DraftVertex | undefined => c.vertices[c.vertices.length - 1];

/** Estamos num ramal (e não no tronco)? */
export const inBranch = (d: CableDraft) => openStack(d).length > 1;

function withActive(d: CableDraft, fn: (c: DraftCable) => DraftCable): DraftCable[] {
  const id = activeCable(d).cableId;
  return d.cables.map((c) => (c.cableId === id ? fn(c) : c));
}

// ---- a store ----

export const cableDraftStore = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Começa o lançamento pelo tronco. */
  begin(cfg: CableChoice) {
    commit({ cables: [newCable(cfg)], actions: [], startedAt: Date.now() });
  },

  /** Adiciona um ponto ao fim do cabo ativo. Devolve false (e ignora) se for o mesmo ponto do último. */
  addVertex(v: DraftVertex, createdElementId?: string): boolean {
    if (!state) return false;
    const last = lastVertex(activeCable(state));
    if (last && sameSpot(last, v)) return false;
    commit({
      ...state,
      cables: withActive(state, (c) => ({ ...c, vertices: [...c.vertices, v] })),
      actions: [...state.actions, createdElementId ? { kind: 'vertex', createdElementId } : { kind: 'vertex' }],
    });
    return true;
  },

  addReserve(elementId: string, meters: number) {
    if (!state) return;
    commit({ ...state, actions: [...state.actions, { kind: 'reserve', cableId: activeCable(state).cableId, elementId, meters }] });
  },

  /**
   * Deriva um ramal a partir do último ponto do cabo ativo, que precisa ser um elemento (CEO, CTO, poste…).
   * O ramal começa nesse elemento. Devolve o id do ramal, ou null se não dá para derivar dali.
   */
  branch(cfg: CableChoice): string | null {
    if (!state) return null;
    const cur = activeCable(state);
    const from = lastVertex(cur);
    if (!from?.elementId) return null;
    const cable = newCable(cfg, [{ ...from }], cur.cableId);
    commit({ ...state, cables: [...state.cables, cable], actions: [...state.actions, { kind: 'branch', cableId: cable.cableId }] });
    return cable.cableId;
  },

  /** Termina o ramal ativo e volta ao cabo de onde ele saiu. Só vale num ramal que já tem ao menos um ponto além da derivação. */
  endBranch(): boolean {
    if (!state || !inBranch(state)) return false;
    const cur = activeCable(state);
    if (cur.vertices.length < 2) return false;
    commit({ ...state, actions: [...state.actions, { kind: 'return', cableId: cur.cableId }] });
    return true;
  },

  /** Desfaz a última ação e devolve qual foi (quem chama apaga o elemento/reserva que ela tinha criado). */
  undo(): DraftAction | null {
    if (!state || state.actions.length === 0) return null;
    const last = state.actions[state.actions.length - 1]!;
    const actions = state.actions.slice(0, -1);
    if (last.kind === 'vertex') {
      commit({ ...state, cables: withActive(state, (c) => ({ ...c, vertices: c.vertices.slice(0, -1) })), actions });
    } else if (last.kind === 'branch') {
      // Todos os pontos do ramal já foram desfeitos antes: sobra só a derivação, e o ramal inteiro some.
      commit({ ...state, cables: state.cables.filter((c) => c.cableId !== last.cableId), actions });
    } else {
      // Reserva sai da lista; "voltei ao tronco" deixa de valer e o ramal volta a ser o ativo.
      commit({ ...state, actions });
    }
    return last;
  },

  clear: () => commit(null),

  /** Ao abrir o app: retoma um lançamento interrompido, se houver e estiver íntegro. */
  async hydrate(): Promise<boolean> {
    const saved = await getSetting<unknown>(KEY, null);
    const d = readDraft(saved);
    if (!d) return false;
    state = d;
    listeners.forEach((l) => l());
    return true;
  },
};

// ---- leitura do que foi gravado ----

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function readCable(raw: unknown): DraftCable | null {
  if (!isObject(raw)) return null;
  const { cableId, cableType, fiberCount, vertices } = raw;
  if (typeof cableId !== 'string' || typeof cableType !== 'string' || typeof fiberCount !== 'number' || !Array.isArray(vertices)) return null;
  return raw as unknown as DraftCable;
}

/** O rascunho gravado: aceita o formato atual e o de antes dos ramais (um cabo só, com as reservas sem `cableId`). */
export function readDraft(raw: unknown): CableDraft | null {
  if (!isObject(raw) || !Array.isArray(raw.actions)) return null;
  const startedAt = typeof raw.startedAt === 'number' ? raw.startedAt : Date.now();
  if (Array.isArray(raw.cables)) {
    const cables = raw.cables.map(readCable);
    if (cables.length === 0 || cables.some((c) => c === null)) return null;
    return { cables: cables as DraftCable[], actions: raw.actions as DraftAction[], startedAt };
  }
  const single = readCable(raw);
  if (!single) return null;
  const { cableId, cableType, fiberCount, colorStandard, vertices } = single;
  const actions = (raw.actions as DraftAction[]).map((a) => (a.kind === 'reserve' && !a.cableId ? { ...a, cableId } : a));
  return { cables: [{ cableId, cableType, fiberCount, ...(colorStandard ? { colorStandard } : {}), vertices }], actions, startedAt };
}

// ---- derivados ----

export const cableLengthMeters = (c: DraftCable) => round2(pathLengthMeters(c.vertices));
export const cableReserveMeters = (d: CableDraft, cableId: string) =>
  round2(d.actions.reduce((sum, a) => sum + (a.kind === 'reserve' && a.cableId === cableId ? a.meters : 0), 0));
export const draftLengthMeters = (d: CableDraft) => round2(d.cables.reduce((sum, c) => sum + cableLengthMeters(c), 0));
export const draftReserveMeters = (d: CableDraft) =>
  round2(d.actions.reduce((sum, a) => sum + (a.kind === 'reserve' ? a.meters : 0), 0));

/** Os cabos que serão salvos: os que têm ao menos 2 pontos (um ramal que só tem a derivação não vira cabo). */
export const cablesToSave = (d: CableDraft) => d.cables.filter((c) => c.vertices.length >= 2);
export const canFinishDraft = (d: CableDraft) => cablesToSave(d).length > 0;

export function useCableDraft<T>(selector: (d: CableDraft | null) => T): T {
  return useSyncExternalStore(cableDraftStore.subscribe, () => selector(state), () => selector(null));
}
