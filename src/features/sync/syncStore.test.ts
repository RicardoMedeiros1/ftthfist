import { beforeEach, describe, expect, it } from 'vitest';
import { CycleAbort, type CycleReport, type Who } from './engine';
import { CHANGE_DEBOUNCE_MS, MIN_AUTO_INTERVAL_MS, PERIODIC_MS, createSyncStore, type SyncStoreDeps } from './syncStore';

const REPORT: CycleReport = { pushed: 0, pulled: 0, lostEdits: 0, newlyBlocked: 0, waiting: 0 };
const ANA: Who = { userId: 'ana', role: 'tecnico' };

// Relogio e temporizadores virtuais + um motor controlavel.
function harness(over: Partial<SyncStoreDeps> = {}) {
  let now = 1_000_000;
  let online = true;
  let who: Who | null = ANA;
  const timers: Array<{ at: number; fn: () => void; dead: boolean }> = [];
  const saved = new Map<string, unknown>();
  const counts = { pending: 0, blocked: 0, tracks: 0 };
  let onCounts: ((c: { pending: number; blocked: number; tracks?: number }) => void) | null = null;
  const cb: Record<'online' | 'visible' | 'every' | 'hidden', Array<() => void>> = { online: [], visible: [], every: [], hidden: [] };
  let bgRequests = 0;
  const cycles: string[] = [];
  let outcome: () => Promise<CycleReport | null> = async () => REPORT;
  let clearedBlocked = 0;

  const deps: SyncStoreDeps = {
    engine: () => ({
      runCycle: async (_w: Who, progress?: (p: { phase: 'enviando' | 'baixando'; done: number }) => void) => {
        cycles.push(String(now));
        progress?.({ phase: 'enviando', done: 1 });
        return outcome();
      },
      counts: async () => ({ ...counts }),
      blockedList: async () => [],
      clearBlocked: async () => void clearedBlocked++,
    }),
    who: () => who,
    isOnline: () => online,
    now: () => now,
    get: async (k, fallback) => (saved.has(k) ? (saved.get(k) as never) : fallback),
    set: async (k, v) => void saved.set(k, v),
    settingKey: 'syncLast',
    after: (ms, fn) => {
      const t = { at: now + ms, fn, dead: false };
      timers.push(t);
      return () => void (t.dead = true);
    },
    watchCounts: (_who, f) => {
      onCounts = f;
      return () => void (onCounts = null);
    },
    backgroundSync: () => void bgRequests++,
    onHidden: (f) => (cb.hidden.push(f), () => undefined),
    onOnline: (f) => (cb.online.push(f), () => undefined),
    onVisible: (f) => (cb.visible.push(f), () => undefined),
    every: (_ms, f) => (cb.every.push(f), () => undefined),
    ...over,
  };
  const store = createSyncStore(deps);

  return {
    store,
    cycles,
    saved,
    counts,
    get clearedBlocked() { return clearedBlocked; },
    get bgRequests() { return bgRequests; },
    setWho: (w: Who | null) => void (who = w),
    setOnline: (o: boolean) => void (online = o),
    setOutcome: (f: () => Promise<CycleReport | null>) => void (outcome = f),
    /** Avanca o relogio e roda os temporizadores vencidos (e o que eles disparam). */
    async tick(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((t) => !t.dead && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = Math.max(now, next.at);
        next.dead = true;
        next.fn();
        await flush();
      }
      now = end;
    },
    /** O banco local mudou: avisa as novas contagens (como o liveQuery do Dexie). */
    changeCounts(pending: number, blocked = 0, tracks = 0) {
      counts.pending = pending;
      counts.blocked = blocked;
      counts.tracks = tracks;
      onCounts?.({ pending, blocked, tracks });
    },
    fire: (kind: 'online' | 'visible' | 'every' | 'hidden') => cb[kind].forEach((f) => f()),
    pendingTimers: () => timers.filter((t) => !t.dead).length,
  };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe('começar', () => {
  it('sem conta ativa: desligado e nada é enviado', async () => {
    h.setWho(null);
    await h.store.start();
    expect(h.store.getState().phase).toBe('desligado');
    expect(h.cycles).toEqual([]);
  });

  it('com conta ativa e internet: sincroniza ao abrir o app', async () => {
    await h.store.start();
    await flush();
    expect(h.cycles).toHaveLength(1);
    const s = h.store.getState();
    expect(s.phase).toBe('ocioso');
    expect(s.firstSync).toBe(false);
    expect(s.lastSyncAt).toBe(1_000_000);
    expect(h.saved.get('syncLast')).toEqual({ at: 1_000_000, lostEdits: 0 });
  });

  it('sem internet: fica "sem rede", não tenta, e tenta quando a internet volta', async () => {
    h.setOnline(false);
    await h.store.start();
    expect(h.store.getState().phase).toBe('sem-rede');
    expect(h.cycles).toEqual([]);
    h.setOnline(true);
    h.fire('online');
    await flush();
    expect(h.cycles).toHaveLength(1);
    expect(h.store.getState().phase).toBe('ocioso');
  });

  it('lembra a última sincronização entre aberturas do app', async () => {
    h.saved.set('syncLast', { at: 555, lostEdits: 2 });
    h.setWho(null);
    await h.store.start();
    expect(h.store.getState()).toMatchObject({ lastSyncAt: 555, lostEdits: 2, firstSync: false });
  });

  it('primeira vez: "firstSync" até concluir um ciclo', async () => {
    h.setWho(null);
    await h.store.start();
    expect(h.store.getState().firstSync).toBe(true);
  });
});

describe('enviar quando grava algo', () => {
  it('espera o tempo de agrupar e envia uma vez só, mesmo com várias gravações seguidas', async () => {
    await h.store.start();
    await flush();
    h.cycles.length = 0;
    await h.tick(MIN_AUTO_INTERVAL_MS); // passou o intervalo mínimo desde o ciclo de abertura (não conta como automático)
    h.changeCounts(1);
    await h.tick(1000);
    h.changeCounts(2);
    await h.tick(1000);
    h.changeCounts(3);
    expect(h.cycles).toHaveLength(0); // ainda agrupando
    await h.tick(CHANGE_DEBOUNCE_MS);
    expect(h.cycles).toHaveLength(1);
  });

  it('gravação contínua (trilha GPS) não gera um ciclo por ponto: no máximo um a cada 30 s', async () => {
    await h.store.start();
    await flush();
    h.cycles.length = 0;
    let pending = 0;
    for (let i = 0; i < 40; i++) {
      pending++;
      h.changeCounts(pending, 0, pending); // todos pontos de trilha
      await h.tick(5_000); // um ponto a cada 5 s, por mais de 3 min
    }
    expect(h.cycles.length).toBeGreaterThan(0);
    expect(h.cycles.length).toBeLessThanOrEqual(Math.ceil((40 * 5_000) / MIN_AUTO_INTERVAL_MS) + 1);
    const times = h.cycles.map(Number);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(MIN_AUTO_INTERVAL_MS - 1);
  });

  it('sem internet a gravação não agenda envio (o app segue guardando no aparelho)', async () => {
    h.setOnline(false);
    await h.store.start();
    h.changeCounts(3);
    await h.tick(60_000);
    expect(h.cycles).toEqual([]);
    expect(h.store.getState().pending).toBe(3);
  });

  it('reduzir a contagem (já enviado) não dispara outro ciclo', async () => {
    await h.store.start();
    await flush();
    h.changeCounts(5);
    await h.tick(CHANGE_DEBOUNCE_MS + MIN_AUTO_INTERVAL_MS);
    h.cycles.length = 0;
    h.changeCounts(0);
    await h.tick(MIN_AUTO_INTERVAL_MS * 2);
    expect(h.cycles).toEqual([]);
  });
});

describe('alteração comum não espera o intervalo da trilha', () => {
  it('um poste gravado logo depois de um ciclo automático sobe em poucos segundos (não espera 30 s)', async () => {
    await h.store.start();
    await flush();
    h.changeCounts(1);
    await h.tick(CHANGE_DEBOUNCE_MS); // ciclo automático
    h.cycles.length = 0;
    await h.tick(2_000);
    h.changeCounts(1); // o ciclo enviou; entra algo novo
    h.changeCounts(2);
    await h.tick(CHANGE_DEBOUNCE_MS);
    expect(h.cycles).toHaveLength(1);
  });

  it('mas ponto de trilha continua limitado: logo depois de um ciclo, espera o intervalo mínimo', async () => {
    await h.store.start();
    await flush();
    h.changeCounts(1);
    await h.tick(CHANGE_DEBOUNCE_MS);
    h.cycles.length = 0;
    h.changeCounts(0);
    h.changeCounts(1, 0, 1); // um ponto de trilha
    await h.tick(CHANGE_DEBOUNCE_MS);
    expect(h.cycles).toHaveLength(0);
    await h.tick(MIN_AUTO_INTERVAL_MS);
    expect(h.cycles).toHaveLength(1);
  });
});

describe('um ciclo de cada vez', () => {
  it('"sincronizar agora" durante um ciclo não abre outro em paralelo; repete uma vez depois', async () => {
    await h.store.start();
    await flush();
    h.cycles.length = 0;
    let release!: () => void;
    h.setOutcome(() => new Promise((r) => (release = () => r(REPORT))));
    const first = h.store.syncNow();
    await flush();
    expect(h.store.getState().phase).toBe('sincronizando');
    const second = h.store.syncNow();
    await flush();
    expect(h.cycles).toHaveLength(1);
    h.setOutcome(async () => REPORT);
    release();
    await first;
    await second;
    await h.tick(10);
    expect(h.cycles).toHaveLength(2); // o segundo pedido rodou depois do primeiro
  });

  it('mostra o progresso enquanto sincroniza', async () => {
    await h.store.start();
    await flush();
    let release!: () => void;
    h.setOutcome(() => new Promise((r) => (release = () => r(REPORT))));
    const p = h.store.syncNow();
    await flush();
    expect(h.store.getState().progress).toEqual({ phase: 'enviando', done: 1 });
    release();
    await p;
    expect(h.store.getState().progress).toBeNull();
  });
});

describe('falhas', () => {
  it('sem conexão no meio: "sem rede" com aviso claro, sem insistir; volta ao normal quando a internet volta', async () => {
    await h.store.start();
    await flush();
    h.setOutcome(async () => { throw new CycleAbort('network', 'x'); });
    await h.store.syncNow();
    expect(h.store.getState()).toMatchObject({ phase: 'sem-rede' });
    expect(h.store.getState().lastError).toMatch(/continuam salvos/i);
    h.cycles.length = 0;
    await h.tick(10 * 60_000);
    expect(h.cycles).toEqual([]); // não fica martelando
    h.setOutcome(async () => REPORT);
    h.fire('online');
    await flush();
    expect(h.store.getState()).toMatchObject({ phase: 'ocioso', lastError: null });
  });

  it('erro do servidor: tenta de novo com espera crescente e zera ao dar certo', async () => {
    await h.store.start();
    await flush();
    h.cycles.length = 0;
    h.setOutcome(async () => { throw new CycleAbort('server', 'x'); });
    await h.store.syncNow();
    expect(h.store.getState().phase).toBe('erro');
    const t0 = Number(h.cycles[0]);
    await h.tick(15_000);
    await h.tick(30_000);
    await h.tick(60_000);
    const gaps = h.cycles.map(Number).map((t, i, a) => (i ? t - a[i - 1]! : 0)).slice(1);
    expect(gaps).toEqual([15_000, 30_000, 60_000]);
    expect(t0).toBeGreaterThan(0);
    h.setOutcome(async () => REPORT);
    await h.tick(120_000);
    expect(h.store.getState().phase).toBe('ocioso');
    h.cycles.length = 0;
    h.setOutcome(async () => { throw new CycleAbort('server', 'x'); });
    await h.store.syncNow();
    h.setOutcome(async () => REPORT);
    await h.tick(15_000); // voltou a esperar 15 s (zerou)
    expect(h.cycles).toHaveLength(2);
  });

  it('sessão vencida: "precisa entrar" e não insiste', async () => {
    await h.store.start();
    await flush();
    h.setOutcome(async () => { throw new CycleAbort('auth', 'x'); });
    await h.store.syncNow();
    expect(h.store.getState().phase).toBe('precisa-entrar');
    h.cycles.length = 0;
    await h.tick(10 * 60_000);
    expect(h.cycles).toEqual([]);
  });

  it('erro inesperado (bug): aviso genérico, nada quebra e tenta de novo depois', async () => {
    await h.store.start();
    await flush();
    const spy = console.error;
    console.error = () => undefined;
    h.setOutcome(async () => { throw new TypeError('boom'); });
    await h.store.syncNow();
    console.error = spy;
    expect(h.store.getState()).toMatchObject({ phase: 'erro' });
    expect(h.store.getState().lastError).toMatch(/inesperado/i);
    expect(h.pendingTimers()).toBeGreaterThan(0);
  });
});

describe('alterações substituídas', () => {
  it('soma o que o ciclo relatou e guarda até o técnico ver', async () => {
    await h.store.start();
    await flush();
    h.setOutcome(async () => ({ ...REPORT, lostEdits: 2 }));
    await h.store.syncNow();
    expect(h.store.getState().lostEdits).toBe(2);
    expect(h.saved.get('syncLast')).toMatchObject({ lostEdits: 2 });
    await h.store.acknowledgeLostEdits();
    expect(h.store.getState().lostEdits).toBe(0);
    expect(h.saved.get('syncLast')).toMatchObject({ lostEdits: 0 });
  });
});

describe('recusados', () => {
  it('"tentar de novo" esquece os bloqueios, atualiza a contagem e envia', async () => {
    await h.store.start();
    await flush();
    h.counts.blocked = 2;
    h.cycles.length = 0;
    await h.store.retryBlocked();
    expect(h.clearedBlocked).toBe(1);
    expect(h.cycles).toHaveLength(1);
  });
});

describe('conta', () => {
  it('sair da conta zera tudo e desliga; entrar de novo (outra pessoa) sincroniza', async () => {
    await h.store.start();
    await flush();
    h.changeCounts(4, 1);
    h.setWho(null);
    h.store.accountChanged();
    expect(h.store.getState()).toMatchObject({ phase: 'desligado', pending: 0, blocked: 0 });
    h.cycles.length = 0;
    h.setWho({ userId: 'bia', role: 'tecnico' });
    h.store.accountChanged();
    await flush();
    expect(h.cycles).toHaveLength(1);
    expect(h.store.getState().phase).toBe('ocioso');
  });

  it('mudanças da conta que não mudam quem está logado não disparam ciclo', async () => {
    await h.store.start();
    await flush();
    h.cycles.length = 0;
    for (let i = 0; i < 5; i++) h.store.accountChanged();
    await flush();
    expect(h.cycles).toEqual([]);
  });

  it('um ciclo de quem saiu não mexe no estado de quem entrou', async () => {
    await h.store.start();
    await flush();
    let release!: () => void;
    h.setOutcome(() => new Promise((r) => (release = () => r({ ...REPORT, lostEdits: 9 }))));
    const old = h.store.syncNow();
    await flush();
    h.setWho({ userId: 'bia', role: 'tecnico' });
    h.setOutcome(async () => REPORT);
    h.store.accountChanged();
    release();
    await old;
    await flush();
    expect(h.store.getState().lostEdits).toBe(0);
  });
});

describe('gatilhos', () => {
  it('voltar para o app (tela visível) sincroniza', async () => {
    await h.store.start();
    await flush();
    h.cycles.length = 0;
    h.fire('visible');
    await flush();
    expect(h.cycles).toHaveLength(1);
  });

  it('o relógio periódico só sincroniza se já passou o intervalo mínimo', async () => {
    await h.store.start();
    await flush();
    h.cycles.length = 0;
    h.fire('every'); // logo depois do ciclo de abertura
    await flush();
    expect(h.cycles).toHaveLength(1); // ciclo de abertura não conta como automático
    await h.tick(5_000);
    h.fire('every');
    await flush();
    expect(h.cycles).toHaveLength(1); // dentro dos 30 s: ignora
    await h.tick(PERIODIC_MS);
    h.fire('every');
    await flush();
    expect(h.cycles).toHaveLength(2);
  });
});

describe('envio com o app fechado: quando pedir ao navegador', () => {
  it('sem internet e com pendências: pede (o navegador envia quando a internet voltar)', async () => {
    h.setOnline(false);
    await h.store.start();
    h.changeCounts(2);
    expect(h.bgRequests).toBeGreaterThan(0);
  });

  it('COM internet, gravar não pede (senão a trilha GPS acordaria o service worker a cada ponto)', async () => {
    await h.store.start();
    await flush();
    for (let i = 1; i <= 20; i++) h.changeCounts(i);
    expect(h.bgRequests).toBe(0);
  });

  it('sem internet e sem pendências: não pede', async () => {
    h.setOnline(false);
    await h.store.start();
    h.changeCounts(0);
    expect(h.bgRequests).toBe(0);
  });

  it('o ciclo falhou por rede ou servidor: pede (se o app fechar agora, o navegador tenta de novo)', async () => {
    await h.store.start();
    await flush();
    h.setOutcome(async () => { throw new CycleAbort('network', 'x'); });
    await h.store.syncNow();
    expect(h.bgRequests).toBe(1);
    h.setOutcome(async () => { throw new CycleAbort('server', 'x'); });
    await h.store.syncNow();
    expect(h.bgRequests).toBe(2);
  });

  it('sessão vencida: não pede (o service worker também não consegue renovar)', async () => {
    await h.store.start();
    await flush();
    h.setOutcome(async () => { throw new CycleAbort('auth', 'x'); });
    await h.store.syncNow();
    expect(h.bgRequests).toBe(0);
  });

  it('o app vai para segundo plano com algo pendente: pede; sem pendências: não', async () => {
    await h.store.start();
    await flush();
    h.fire('hidden');
    expect(h.bgRequests).toBe(0);
    h.changeCounts(3);
    h.fire('hidden');
    expect(h.bgRequests).toBe(1);
  });

  it('alguém tenta sincronizar com a internet já caída e há pendências: pede', async () => {
    await h.store.start();
    await flush();
    h.changeCounts(2); // com internet: não pede
    expect(h.bgRequests).toBe(0);
    h.setOnline(false);
    await h.store.syncNow(); // o app percebe que está sem rede
    expect(h.store.getState().phase).toBe('sem-rede');
    expect(h.bgRequests).toBe(1);
  });

  it('sem conta ativa nunca pede', async () => {
    h.setWho(null);
    await h.store.start();
    h.fire('hidden');
    h.setOnline(false);
    h.changeCounts(4);
    expect(h.bgRequests).toBe(0);
  });

  it('o service worker já está enviando (ciclo não rodou): não marca como sincronizado e confere de novo logo depois', async () => {
    await h.store.start();
    await flush();
    const before = h.store.getState().lastSyncAt;
    await h.tick(1000); // o relógio anda: se marcasse como sincronizado, a hora mudaria
    h.cycles.length = 0;
    h.setOutcome(async () => null);
    await h.store.syncNow();
    expect(h.store.getState().phase).toBe('ocioso');
    expect(h.store.getState().lastSyncAt).toBe(before);
    h.setOutcome(async () => REPORT);
    await h.tick(5_000);
    expect(h.cycles).toHaveLength(2);
  });
});
