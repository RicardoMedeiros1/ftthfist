import { useSyncExternalStore } from 'react';
import type { ElementType, PositionSource } from '../../db/types';

// Rascunho da marcação em andamento (tipo + posição). Fica em memória: só vai para o banco ao salvar.

export interface DraftPosition {
  lat: number;
  lng: number;
  /** Só existe enquanto a posição for a leitura do GPS; arrastar o ponto a torna manual. */
  accuracy?: number;
  source: PositionSource;
}

export interface DraftState {
  /** idle · tipo (escolhendo) · posicao (marcando um novo) · mover (reposicionando um existente) · cabo (lançando um cabo) · cabo-editar (ajustando o traçado de um cabo salvo) */
  phase: 'idle' | 'tipo' | 'posicao' | 'mover' | 'cabo' | 'cabo-editar';
  type: ElementType | null;
  mode: 'gps' | 'manual';
  capture: 'buscando' | 'concluido' | 'erro';
  elapsedMs: number;
  error: string | null;
  position: DraftPosition | null;
  /** Muda a cada nova busca, para reiniciar o componente que escuta o GPS. */
  captureRun: number;
  /** Aviso rápido no mapa (ex.: "Salvo: Poste"). */
  notice: string | null;
  noticeId: number;
  /** Elemento sendo movido e de onde ele saiu (para saber se houve mudança). */
  movingId: string | null;
  movingFrom: { lat: number; lng: number } | null;
  /** Cabo sendo editado no mapa e o ponto do traçado selecionado. */
  editingCableId: string | null;
  selectedVertex: number | null;
  /** O "+" foi tocado sem atividade aberta: a tela de nova atividade explica o motivo. */
  needsActivityHint: boolean;
}

const initial: DraftState = {
  phase: 'idle',
  type: null,
  mode: 'gps',
  capture: 'buscando',
  elapsedMs: 0,
  error: null,
  position: null,
  captureRun: 0,
  notice: null,
  noticeId: 0,
  movingId: null,
  movingFrom: null,
  editingCableId: null,
  selectedVertex: null,
  needsActivityHint: false,
};

let state: DraftState = initial;
const listeners = new Set<() => void>();

function set(patch: Partial<DraftState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const freshSearch = (): Partial<DraftState> => ({
  mode: 'gps',
  capture: 'buscando',
  elapsedMs: 0,
  error: null,
  position: null,
  captureRun: state.captureRun + 1,
});

export const draftStore = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  startAdd: () => set({ phase: 'tipo', type: null, position: null, error: null }),
  /** Escolher o tipo já inicia a busca de GPS (caso mais comum, um toque a menos). */
  chooseType: (type: ElementType) => set({ phase: 'posicao', type, ...freshSearch() }),

  setGpsBest: (p: { lat: number; lng: number; accuracy: number }) =>
    set({ position: { lat: p.lat, lng: p.lng, accuracy: p.accuracy, source: 'gps' } }),
  setElapsed: (elapsedMs: number) => set({ elapsedMs }),
  finishCapture() {
    if (state.capture === 'buscando' && state.position) set({ capture: 'concluido' });
  },
  failCapture(message: string) {
    if (state.capture === 'buscando') set({ capture: 'erro', error: message });
  },
  retryGps: () => set(freshSearch()),

  useManual: () => set({ mode: 'manual', capture: 'concluido', error: null, position: null }),
  setManualPosition: (lat: number, lng: number) => set({ position: { lat, lng, source: 'manual' } }),
  /** Arrastar o marcador: a posição deixa de ser a leitura do GPS e perde a precisão guardada. */
  dragTo: (lat: number, lng: number) => set({ position: { lat, lng, source: 'manual' } }),

  /** Desiste da marcação (não grava nada). */
  cancel: () => set({ ...initial, notice: state.notice, noticeId: state.noticeId }),
  /** Marcação salva: limpa o rascunho e mostra o aviso. */
  saved: (notice: string) => set({ ...initial, notice, noticeId: state.noticeId + 1 }),

  /** Começa a mover um elemento existente: o marcador vira o do rascunho, arrastável. */
  startMove: (el: { id: string; type: ElementType; lat: number; lng: number }) =>
    set({
      phase: 'mover',
      type: el.type,
      mode: 'manual',
      capture: 'concluido',
      elapsedMs: 0,
      error: null,
      position: { lat: el.lat, lng: el.lng, source: 'manual' },
      movingId: el.id,
      movingFrom: { lat: el.lat, lng: el.lng },
    }),
  setError: (error: string | null) => set({ error }),

  /** Entra no modo de lançar cabo. A `position` do rascunho passa a ser o poste de precisão baixa aguardando ajuste. */
  startCable: () =>
    set({
      phase: 'cabo',
      type: 'poste',
      mode: 'gps',
      capture: 'concluido',
      elapsedMs: 0,
      error: null,
      position: null,
      movingId: null,
      movingFrom: null,
    }),
  startCableEdit: (cableId: string) =>
    set({ phase: 'cabo-editar', editingCableId: cableId, selectedVertex: null, type: null, position: null, error: null }),
  selectVertex: (i: number | null) => set({ selectedVertex: i }),
  /** Descarta só o ponto pendente (continua no modo cabo). */
  discardPosition: () => set({ position: null, error: null }),

  hintNeedsActivity: () => set({ needsActivityHint: true }),
  clearHint: () => set({ needsActivityHint: false }),
};

/** Lê uma parte do rascunho; `selector` deve devolver valores estáveis (primitivos ou referências do estado). */
export function useDraft<T>(selector: (s: DraftState) => T): T {
  return useSyncExternalStore(draftStore.subscribe, () => selector(state), () => selector(initial));
}
