import { useSyncExternalStore } from 'react';
import { SETTING_KEYS, db, getSetting, type RotaFibraDB } from '../../db/db';
import { distanceMeters } from '../../lib/geo';
import { createWakeLock, type WakeLockLike } from '../../lib/wakeLock';
import { filterTrackPoint } from './trackFilter';
import { trackDistanceMeters } from './trackStats';
import { trackRepo } from './trackRepo';

// Gravador da trilha GPS. Limitação de PWA: não há gravação em segundo plano. Se a tela apagar ou o app for
// fechado, o navegador para de entregar posições; o gravador percebe isso, fecha o trecho e abre outro ao voltar.

export type TrackStatus = 'parada' | 'gravando' | 'pausada';
export type WakeLockStatus = 'ativo' | 'indisponivel' | 'inativo';

export interface TrackState {
  status: TrackStatus;
  activityId: string | null;
  /** Trecho atual. Pausar, retomar ou a tela apagar abre um trecho novo. */
  segment: number;
  /** Tempo gravado até o último fechamento de período. */
  activeMs: number;
  /** Quando o período atual começou (só enquanto grava e a tela está ligada). */
  lastResumedAt: number | null;
  lastSeenAt: number;
  /** A tela apagou (ou o app foi para o fundo): o navegador não entrega posições. */
  suspended: boolean;
  distanceM: number;
  points: number;
  lastAccuracy: number | null;
  wakeLock: WakeLockStatus;
  /** Aviso para o técnico (interrupção, permissão, etc.). */
  message: string | null;
}

const initial: TrackState = {
  status: 'parada',
  activityId: null,
  segment: 0,
  activeMs: 0,
  lastResumedAt: null,
  lastSeenAt: 0,
  suspended: false,
  distanceM: 0,
  points: 0,
  lastAccuracy: null,
  wakeLock: 'inativo',
  message: null,
};

/** Tempo gravado agora (inclui o período em andamento). */
export function elapsedMs(s: TrackState, now: number): number {
  const running = s.status === 'gravando' && !s.suspended && s.lastResumedAt !== null;
  return s.activeMs + (running ? Math.max(0, now - s.lastResumedAt!) : 0);
}

export interface GeoLike {
  watchPosition(
    ok: (p: { coords: { latitude: number; longitude: number; accuracy: number; speed: number | null }; timestamp: number }) => void,
    err: (e: { code: number }) => void,
    opts: PositionOptions,
  ): number;
  clearWatch(id: number): void;
}

export interface VisibilityLike {
  isHidden(): boolean;
  onChange(cb: () => void): () => void;
}

export interface RecorderDeps {
  database: RotaFibraDB;
  geo: GeoLike | null;
  now: () => number;
  wakeLock: WakeLockLike;
  visibility: VisibilityLike;
  technician: () => Promise<string>;
}

const PERSIST_EVERY_MS = 10_000;
const MSG = {
  interrupted: 'A gravação foi interrompida porque o app foi fechado ou recarregado. Toque em Retomar para continuar (começa um trecho novo).',
  screen: 'A tela apagou e a gravação ficou parada nesse intervalo. Um trecho novo foi iniciado.',
  denied: 'Permissão de localização negada. Libere o GPS nas configurações do navegador para gravar a trilha.',
  noGps: 'Este aparelho não oferece geolocalização.',
  activityEnded: 'Gravação encerrada porque a atividade foi concluída.',
};

export function createTrackRecorder(deps: RecorderDeps) {
  const repo = trackRepo(deps.database);
  let state: TrackState = initial;
  const listeners = new Set<() => void>();
  let watchId: number | null = null;
  let lastAccepted: { lat: number; lng: number } | null = null;
  let createdBy = '';
  let lastPersistAt = 0;
  let unsubscribeVisibility: (() => void) | null = null;

  const set = (patch: Partial<TrackState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  async function persist() {
    lastPersistAt = deps.now();
    try {
      if (state.status === 'parada') {
        await deps.database.settings.delete(SETTING_KEYS.trackState);
      } else {
        const { status, activityId, segment, activeMs, lastResumedAt, lastSeenAt, suspended } = state;
        await deps.database.settings.put({
          key: SETTING_KEYS.trackState,
          value: { status, activityId, segment, activeMs, lastResumedAt, lastSeenAt, suspended },
        });
      }
    } catch {
      /* gravar o estado não pode derrubar a gravação dos pontos */
    }
  }

  /** Fecha o período em andamento somando o tempo dele. */
  function closePeriod(at: number): Partial<TrackState> {
    const running = state.status === 'gravando' && !state.suspended && state.lastResumedAt !== null;
    return { activeMs: state.activeMs + (running ? Math.max(0, at - state.lastResumedAt!) : 0), lastResumedAt: null };
  }

  function stopWatch() {
    if (watchId !== null) deps.geo?.clearWatch(watchId);
    watchId = null;
  }

  function startWatch() {
    stopWatch();
    if (!deps.geo) return;
    watchId = deps.geo.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }

  async function acquireWake() {
    set({ wakeLock: await deps.wakeLock.acquire() });
  }
  async function releaseWake() {
    await deps.wakeLock.release();
    set({ wakeLock: 'inativo' });
  }

  function onFix(pos: Parameters<Parameters<GeoLike['watchPosition']>[0]>[0]) {
    if (state.status !== 'gravando' || state.suspended || !state.activityId) return;
    const now = deps.now();
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    set({ lastSeenAt: now, lastAccuracy: p.accuracy });

    if (filterTrackPoint(lastAccepted, p) === 'aceito') {
      // Atualiza a memória antes de gravar: duas leituras seguidas não podem passar juntas pelo filtro dos 5 m.
      const added = lastAccepted ? distanceMeters(lastAccepted, p) : 0;
      lastAccepted = { lat: p.lat, lng: p.lng };
      set({ distanceM: state.distanceM + added, points: state.points + 1 });
      const speed = pos.coords.speed;
      void repo
        .add(
          {
            activityId: state.activityId,
            ...p,
            timestamp: pos.timestamp,
            ...(typeof speed === 'number' && Number.isFinite(speed) ? { speed } : {}),
            segment: state.segment,
          },
          createdBy,
        )
        .catch(() => set({ message: 'Não foi possível gravar um ponto da trilha.' }));
    }
    if (now - lastPersistAt >= PERSIST_EVERY_MS) void persist();
  }

  function onError(e: { code: number }) {
    // 1 = permissão negada. Sinal fraco/timeout não encerra: o GPS volta sozinho.
    if (e.code === 1) void stop(MSG.denied);
  }

  function onVisibility() {
    if (state.status !== 'gravando') return;
    const now = deps.now();
    if (deps.visibility.isHidden()) {
      if (!state.suspended) {
        set({ ...closePeriod(now), suspended: true });
        void persist();
      }
    } else if (state.suspended) {
      // Voltou: o intervalo em que a tela esteve apagada fica de fora e o trecho seguinte começa limpo.
      lastAccepted = null;
      set({ suspended: false, segment: state.segment + 1, lastResumedAt: now, lastSeenAt: now, message: MSG.screen });
      startWatch();
      void acquireWake();
      void persist();
    }
  }

  function watchVisibility() {
    unsubscribeVisibility?.();
    unsubscribeVisibility = deps.visibility.onChange(onVisibility);
  }

  async function loadActivityStats(activityId: string) {
    const pts = await repo.listFor(activityId);
    return { distanceM: trackDistanceMeters(pts), points: pts.length };
  }

  async function start(activityId: string): Promise<void> {
    if (state.status !== 'parada') return;
    if (!deps.geo) {
      set({ message: MSG.noGps });
      return;
    }
    createdBy = await deps.technician();
    const [segment, stats] = await Promise.all([repo.nextSegment(activityId), loadActivityStats(activityId)]);
    const now = deps.now();
    lastAccepted = null;
    set({
      status: 'gravando',
      activityId,
      segment,
      activeMs: 0,
      lastResumedAt: now,
      lastSeenAt: now,
      suspended: false,
      ...stats,
      lastAccuracy: null,
      message: null,
    });
    watchVisibility();
    startWatch();
    await acquireWake();
    await persist();
  }

  async function pause(): Promise<void> {
    if (state.status !== 'gravando') return;
    const now = deps.now();
    stopWatch();
    set({ ...closePeriod(now), status: 'pausada', suspended: false, message: null });
    await releaseWake();
    await persist();
  }

  async function resume(): Promise<void> {
    if (state.status !== 'pausada' || !state.activityId) return;
    const now = deps.now();
    lastAccepted = null; // o primeiro ponto do trecho novo sempre entra
    createdBy = createdBy || (await deps.technician());
    set({ status: 'gravando', segment: state.segment + 1, lastResumedAt: now, lastSeenAt: now, suspended: false, message: null });
    watchVisibility();
    startWatch();
    await acquireWake();
    await persist();
  }

  async function stop(message: string | null = null): Promise<void> {
    if (state.status === 'parada') return;
    const now = deps.now();
    stopWatch();
    unsubscribeVisibility?.();
    unsubscribeVisibility = null;
    set({ ...closePeriod(now), status: 'parada', activityId: null, suspended: false, message });
    await releaseWake();
    await persist(); // 'parada' remove o estado salvo
  }

  /** A atividade aberta mudou (concluída ou trocada): a gravação não pode continuar numa atividade que não é mais a aberta. */
  async function syncActivity(openId: string | null): Promise<void> {
    if (state.status !== 'parada' && state.activityId !== openId) await stop(MSG.activityEnded);
  }

  /** Ao abrir o app: se havia gravação, ela foi interrompida (fechar o app encerra o GPS); volta pausada. */
  async function hydrate(): Promise<void> {
    if (state.status !== 'parada') return;
    const saved = (await deps.database.settings.get(SETTING_KEYS.trackState))?.value as Partial<TrackState> | undefined;
    const ok =
      saved &&
      typeof saved === 'object' &&
      (saved.status === 'gravando' || saved.status === 'pausada') &&
      typeof saved.activityId === 'string' &&
      typeof saved.segment === 'number' &&
      typeof saved.activeMs === 'number';
    if (!ok) return;
    const wasRunning = saved.status === 'gravando' && !saved.suspended && typeof saved.lastResumedAt === 'number';
    // O app parou de gravar em algum momento depois da última leitura que recebeu.
    const lastSeen = typeof saved.lastSeenAt === 'number' ? saved.lastSeenAt : (saved.lastResumedAt as number);
    const activeMs = saved.activeMs! + (wasRunning ? Math.max(0, lastSeen - (saved.lastResumedAt as number)) : 0);
    createdBy = await deps.technician();
    set({
      ...initial,
      status: 'pausada',
      activityId: saved.activityId!,
      segment: saved.segment!,
      activeMs,
      lastSeenAt: lastSeen,
      ...(await loadActivityStats(saved.activityId!)),
      message: saved.status === 'gravando' ? MSG.interrupted : null,
    });
    await persist();
  }

  return {
    getState: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start,
    pause,
    resume,
    stop: () => stop(null),
    syncActivity,
    hydrate,
    /** Depois de apagar a trilha da atividade: zera os contadores mostrados. */
    async refreshStats() {
      if (state.activityId) set(await loadActivityStats(state.activityId));
    },
    dismissMessage: () => set({ message: null }),
  };
}

function realDeps(): RecorderDeps {
  return {
    database: db,
    geo: typeof navigator !== 'undefined' && 'geolocation' in navigator ? (navigator.geolocation as unknown as GeoLike) : null,
    now: () => Date.now(),
    wakeLock: createWakeLock(),
    visibility: {
      isHidden: () => document.visibilityState === 'hidden',
      onChange(cb) {
        document.addEventListener('visibilitychange', cb);
        return () => document.removeEventListener('visibilitychange', cb);
      },
    },
    technician: () => getSetting<string>(SETTING_KEYS.technician, ''),
  };
}

export const trackRecorder = createTrackRecorder(realDeps());

export function useTrack<T>(selector: (s: TrackState) => T): T {
  return useSyncExternalStore(trackRecorder.subscribe, () => selector(trackRecorder.getState()), () => selector(initial));
}
