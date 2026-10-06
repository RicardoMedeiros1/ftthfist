import { CycleAbort, type CycleReport, type Progress, type SyncEngine, type Who } from './engine';
import { abortMessage } from './messages';

// Estado e gatilhos da sincronizacao (em segundo plano). Regra de ouro: NADA aqui pode atrapalhar o trabalho
// de campo; qualquer falha vira um aviso discreto e o app continua salvando no aparelho.

export type SyncPhase =
  | 'desligado' // sem conta ativa (ou build sem servidor): nada a sincronizar
  | 'ocioso'
  | 'sincronizando'
  | 'sem-rede'
  | 'precisa-entrar'
  | 'erro';

export interface SyncState {
  phase: SyncPhase;
  /** Aguardando envio (sem contar os recusados). */
  pending: number;
  /** Recusados pelo servidor (precisam de atencao). */
  blocked: number;
  progress: Progress | null;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Alteracoes minhas que foram substituidas por uma versao mais recente e o tecnico ainda nao viu. */
  lostEdits: number;
  /** Este aparelho ainda nao concluiu nenhuma sincronizacao (a primeira baixa a rede toda). */
  firstSync: boolean;
}

export type SyncReason = 'inicio' | 'entrou' | 'online' | 'visivel' | 'mudanca' | 'periodico' | 'manual' | 'repetir';

export interface SyncStoreDeps {
  /** O motor (sem rede ate o primeiro envio); null se o build nao tem servidor. */
  engine(): SyncEngine | null;
  /** Quem esta logado e ativo; null = sem conta ativa. */
  who(): Who | null;
  isOnline(): boolean;
  now(): number;
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  /** Agenda `fn` daqui a `ms`; devolve como cancelar. */
  after(ms: number, fn: () => void): () => void;
  /** Acompanha as contagens de pendentes (reage a cada gravacao local). Devolve como parar. */
  watchCounts(who: Who, onCounts: (c: { pending: number; blocked: number }) => void): () => void;
  /** Gatilhos externos: voltou a internet, o app voltou para a tela, relogio periodico. */
  onOnline(cb: () => void): () => void;
  onVisible(cb: () => void): () => void;
  every(ms: number, cb: () => void): () => void;
  settingKey: string;
}

/** Espera depois de uma gravacao local antes de enviar (junta varias gravacoes seguidas). */
export const CHANGE_DEBOUNCE_MS = 4_000;
/** Entre ciclos automaticos disparados por gravacao/relogio (a trilha grava a cada poucos segundos). */
export const MIN_AUTO_INTERVAL_MS = 30_000;
export const PERIODIC_MS = 2 * 60_000;
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000];

interface Persisted {
  at: number;
  lostEdits: number;
}

export function createSyncStore(deps: SyncStoreDeps) {
  let state: SyncState = { phase: 'desligado', pending: 0, blocked: 0, progress: null, lastSyncAt: null, lastError: null, lostEdits: 0, firstSync: true };
  const listeners = new Set<() => void>();
  let running = false;
  let rerun = false;
  let failures = 0;
  let lastAutoAt = -Infinity;
  let cancelTimer: (() => void) | null = null;
  let stopWatch: (() => void) | null = null;
  let watched: string | null = null;
  let started = false;
  let lastPending = 0;
  let generation = 0; // muda quando troca de conta: ciclos antigos nao mexem no estado novo

  const set = (patch: Partial<SyncState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  async function loadPersisted() {
    const saved = await deps.get<Persisted | null>(deps.settingKey, null);
    if (saved) set({ lastSyncAt: saved.at, lostEdits: saved.lostEdits, firstSync: false });
  }
  const persist = () => deps.set(deps.settingKey, { at: state.lastSyncAt ?? 0, lostEdits: state.lostEdits } satisfies Persisted);

  function schedule(ms: number, reason: SyncReason) {
    cancelTimer?.();
    cancelTimer = deps.after(ms, () => {
      cancelTimer = null;
      void run(reason);
    });
  }

  function setCounts(c: { pending: number; blocked: number }) {
    const grew = c.pending > lastPending;
    lastPending = c.pending;
    set({ pending: c.pending, blocked: c.blocked });
    if (grew && !running && deps.who() && deps.isOnline()) {
      // gravou algo novo: envia logo, mas junta gravacoes seguidas e nao passa de um ciclo a cada MIN_AUTO_INTERVAL_MS
      const wait = Math.max(CHANGE_DEBOUNCE_MS, lastAutoAt + MIN_AUTO_INTERVAL_MS - deps.now());
      schedule(wait, 'mudanca');
    }
  }

  /** (Re)liga o acompanhamento das contagens para quem esta logado agora. Devolve true se quem esta logado mudou. */
  function watch(): boolean {
    const who = deps.who();
    const key = who ? `${who.userId}:${who.role}` : null;
    if (key === watched) return false;
    stopWatch?.();
    stopWatch = null;
    watched = key;
    generation++;
    if (!who) {
      cancelTimer?.();
      cancelTimer = null;
      lastPending = 0;
      set({ phase: 'desligado', pending: 0, blocked: 0, progress: null, lastError: null });
      return true;
    }
    if (state.phase === 'desligado') set({ phase: deps.isOnline() ? 'ocioso' : 'sem-rede' });
    stopWatch = deps.watchCounts(who, setCounts);
    return true;
  }

  async function run(reason: SyncReason): Promise<CycleReport | null> {
    watch();
    const who = deps.who();
    const engine = deps.engine();
    if (!who || !engine) return null;
    if (running) {
      rerun = true;
      return null;
    }
    if (!deps.isOnline()) {
      set({ phase: 'sem-rede' });
      return null;
    }
    const gen = generation;
    running = true;
    if (reason === 'mudanca' || reason === 'periodico') lastAutoAt = deps.now();
    set({ phase: 'sincronizando', progress: null, lastError: null });
    let report: CycleReport | null = null;
    try {
      report = await engine.runCycle(who, (p) => {
        if (gen === generation) set({ progress: p });
      });
      if (gen === generation) {
        failures = 0;
        set({
          phase: 'ocioso',
          progress: null,
          lastSyncAt: deps.now(),
          lostEdits: state.lostEdits + report.lostEdits,
          firstSync: false,
        });
        await persist();
      }
    } catch (e) {
      if (gen === generation) {
        failures++;
        if (e instanceof CycleAbort) {
          set({
            phase: e.reason === 'network' ? 'sem-rede' : e.reason === 'auth' ? 'precisa-entrar' : 'erro',
            progress: null,
            lastError: abortMessage(e.reason),
          });
          // sessao vencida nao melhora sozinha; o resto tenta de novo com espera crescente
          if (e.reason !== 'auth' && e.reason !== 'network') schedule(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]!, 'repetir');
        } else {
          console.error('sincronizacao: erro inesperado', e);
          set({ phase: 'erro', progress: null, lastError: 'Algo inesperado aconteceu ao sincronizar. Seus dados continuam salvos no aparelho.' });
          schedule(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]!, 'repetir');
        }
      }
    } finally {
      running = false;
      await refreshCounts(); // le a conta de agora, entao serve mesmo se mudou no meio
      if (rerun) {
        rerun = false;
        schedule(0, 'repetir');
      }
    }
    return report;
  }

  async function refreshCounts() {
    const who = deps.who();
    const engine = deps.engine();
    if (!who || !engine) return;
    const c = await engine.counts(who);
    lastPending = c.pending;
    set({ pending: c.pending, blocked: c.blocked });
  }

  return {
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    /** Liga os gatilhos (uma vez). Chamar depois de `accountStore.init()`. */
    async start() {
      if (started) return;
      started = true;
      await loadPersisted();
      watch();
      deps.onOnline(() => void run('online'));
      deps.onVisible(() => void run('visivel'));
      deps.every(PERIODIC_MS, () => {
        if (deps.now() - lastAutoAt >= MIN_AUTO_INTERVAL_MS) void run('periodico');
      });
      if (deps.who()) await run('inicio');
    },

    /** A conta mudou (entrou, saiu, foi aprovada). */
    accountChanged() {
      if (watch() && deps.who()) void run('entrou');
    },

    /** "Sincronizar agora". */
    syncNow: () => run('manual'),

    /** "Tentar de novo" os recusados: esquece os bloqueios e envia. */
    async retryBlocked() {
      await deps.engine()?.clearBlocked();
      await refreshCounts();
      return run('manual');
    },

    /** O tecnico viu o aviso de alteracoes substituidas. */
    async acknowledgeLostEdits() {
      set({ lostEdits: 0 });
      await persist();
    },

    refreshCounts,
  };
}

export type SyncStore = ReturnType<typeof createSyncStore>;
