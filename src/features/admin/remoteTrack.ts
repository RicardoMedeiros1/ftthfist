import type { Bounds } from '../map/mapCommands';
import { trackDistanceMeters } from '../tracking/trackStats';
import { adminErrorText } from './people';
import type { AdminApi, RemoteTrackPoint } from './adminApi';

// A trilha GPS de uma atividade de OUTRA pessoa: baixada so quando o administrador pede, guardada so na memoria
// (nada vai para o IndexedDB) e desenhada no mapa ate ele esconder.

export const TRACK_PAGE = 500;
export const TRACK_MAX_POINTS = 20000;

export async function loadTrack(
  api: Pick<AdminApi, 'trackPage'>,
  activityId: string,
  opts: { pageSize?: number; maxPoints?: number; onProgress?: (n: number) => void; isCancelled?: () => boolean } = {},
): Promise<{ points: RemoteTrackPoint[]; truncated: boolean }> {
  const pageSize = opts.pageSize ?? TRACK_PAGE;
  const maxPoints = opts.maxPoints ?? TRACK_MAX_POINTS;
  const points: RemoteTrackPoint[] = [];
  let cursor = undefined as Parameters<AdminApi['trackPage']>[2];
  for (;;) {
    const page = await api.trackPage(activityId, pageSize, cursor);
    if (opts.isCancelled?.()) return { points, truncated: false };
    if (page.points.length === 0 || !page.last) return { points, truncated: false };
    points.push(...page.points);
    opts.onProgress?.(points.length);
    if (points.length >= maxPoints) return { points, truncated: true };
    cursor = page.last; // o servidor pode devolver menos que o pedido (limite de linhas): so uma pagina vazia encerra
  }
}

export function pointsBounds(points: { lat: number; lng: number }[]): Bounds | null {
  if (points.length === 0) return null;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of points) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
  }
  return [s, w, n, e];
}

export interface RemoteTrackState {
  activityId: string | null;
  /** Nome para a faixa do mapa (ex.: "Rua X · Fulano"). */
  label: string;
  status: 'oculta' | 'baixando' | 'pronta' | 'erro';
  points: RemoteTrackPoint[];
  loaded: number;
  truncated: boolean;
  error: string | null;
  meters: number;
}

const HIDDEN: RemoteTrackState = { activityId: null, label: '', status: 'oculta', points: [], loaded: 0, truncated: false, error: null, meters: 0 };

export interface RemoteTrackDeps {
  api(): AdminApi | null;
  /** Chamado quando a trilha chegou (para o mapa enquadrar). */
  onReady?(bounds: Bounds | null): void;
}

export function createRemoteTrackStore(deps: RemoteTrackDeps) {
  let state: RemoteTrackState = HIDDEN;
  let seq = 0;
  const listeners = new Set<() => void>();
  const set = (s: RemoteTrackState) => {
    state = s;
    listeners.forEach((l) => l());
  };

  async function show(activityId: string, label: string): Promise<void> {
    const api = deps.api();
    const mine = ++seq;
    if (!api) return set({ ...HIDDEN, activityId, label, status: 'erro', error: 'Este app não está ligado a um servidor.' });
    set({ ...HIDDEN, activityId, label, status: 'baixando' });
    try {
      const { points, truncated } = await loadTrack(api, activityId, {
        isCancelled: () => mine !== seq,
        onProgress: (n) => mine === seq && set({ ...state, loaded: n }),
      });
      if (mine !== seq) return; // escondida (ou trocada por outra) enquanto baixava
      set({ activityId, label, status: 'pronta', points, loaded: points.length, truncated, error: null, meters: trackDistanceMeters(points) });
      deps.onReady?.(pointsBounds(points));
    } catch (e) {
      if (mine === seq) set({ ...HIDDEN, activityId, label, status: 'erro', error: adminErrorText(e) });
    }
  }

  return {
    show,
    hide() {
      seq++; // uma carga em andamento deixa de valer
      set(HIDDEN);
    },
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export type RemoteTrackStore = ReturnType<typeof createRemoteTrackStore>;
