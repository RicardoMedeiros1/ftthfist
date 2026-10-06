import { describe, expect, it } from 'vitest';
import type { AdminApi, RemoteTrackPoint, TrackCursor } from './adminApi';
import { AdminError } from './adminApi';
import { TRACK_MAX_POINTS, createRemoteTrackStore, loadTrack, pointsBounds } from './remoteTrack';

const pt = (i: number, over: Partial<RemoteTrackPoint> = {}): RemoteTrackPoint => ({ id: `p${String(i).padStart(3, '0')}`, lat: -23 + i * 0.001, lng: -46, accuracy: 5, timestamp: 1_000_000 + i * 1000, segment: 0, ...over });

/** Servidor falso: devolve os pontos em paginas, no maximo `cap` por resposta (como o limite de linhas do PostgREST). */
function fakeApi(all: RemoteTrackPoint[], cap = Infinity) {
  const calls: { limit: number; after?: TrackCursor }[] = [];
  const api: Pick<AdminApi, 'trackPage'> = {
    async trackPage(_a, limit, after) {
      calls.push({ limit, after });
      const start = after ? all.findIndex((p) => p.id === after.id) + 1 : 0;
      const points = all.slice(start, start + Math.min(limit, cap));
      const last = points.at(-1);
      return { points, last: last ? { ts: String(last.timestamp), id: last.id } : null };
    },
  };
  return { api, calls };
}

describe('loadTrack', () => {
  it('junta as paginas em ordem e encerra na pagina vazia', async () => {
    const all = Array.from({ length: 7 }, (_, i) => pt(i));
    const { api, calls } = fakeApi(all);
    const r = await loadTrack(api, 'a1', { pageSize: 3 });
    expect(r.points.map((p) => p.id)).toEqual(all.map((p) => p.id));
    expect(r.truncated).toBe(false);
    expect(calls.map((c) => c.after?.id)).toEqual([undefined, 'p002', 'p005', 'p006']); // a 4a pagina (vazia) confirma o fim
  });

  it('se o servidor devolve menos que o pedido (limite de linhas), continua ate acabar', async () => {
    const all = Array.from({ length: 10 }, (_, i) => pt(i));
    const r = await loadTrack(fakeApi(all, 4).api, 'a1', { pageSize: 500 });
    expect(r.points).toHaveLength(10);
  });

  it('para no limite e avisa que cortou', async () => {
    const all = Array.from({ length: 50 }, (_, i) => pt(i));
    const r = await loadTrack(fakeApi(all).api, 'a1', { pageSize: 10, maxPoints: 25 });
    expect(r.truncated).toBe(true);
    expect(r.points.length).toBeGreaterThanOrEqual(25);
    expect(r.points.length).toBeLessThan(50);
  });

  it('o limite e exato quando as paginas se alinham a ele: nao baixa uma pagina a mais', async () => {
    const all = Array.from({ length: 25 }, (_, i) => pt(i));
    const r = await loadTrack(fakeApi(all).api, 'a1', { pageSize: 10, maxPoints: 20 });
    expect(r.points).toHaveLength(20);
    expect(r.truncated).toBe(true);
  });

  it('o limite padrao e de 20 mil pontos', () => {
    expect(TRACK_MAX_POINTS).toBe(20000);
  });

  it('cancelado no meio: nao continua pedindo paginas', async () => {
    const all = Array.from({ length: 30 }, (_, i) => pt(i));
    const { api, calls } = fakeApi(all);
    let n = 0;
    await loadTrack(api, 'a1', { pageSize: 5, isCancelled: () => ++n > 1 });
    expect(calls.length).toBe(2);
  });
});

describe('pointsBounds', () => {
  it('sul, oeste, norte, leste; vazio = null', () => {
    expect(pointsBounds([])).toBeNull();
    expect(pointsBounds([{ lat: -23.5, lng: -46.7 }, { lat: -23.4, lng: -46.6 }, { lat: -23.6, lng: -46.65 }])).toEqual([-23.6, -46.7, -23.4, -46.6]);
  });
});

describe('createRemoteTrackStore', () => {
  const states = (store: ReturnType<typeof createRemoteTrackStore>) => {
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getState().status));
    return seen;
  };

  it('baixa, mede (trechos separados) e avisa para enquadrar o mapa', async () => {
    const all = [pt(0), pt(1), pt(2, { segment: 1 }), pt(3, { segment: 1 })];
    const bounds: unknown[] = [];
    const store = createRemoteTrackStore({ api: () => ({ trackPage: fakeApi(all).api.trackPage }) as AdminApi, onReady: (b) => bounds.push(b) });
    const seen = states(store);
    await store.show('a1', 'Rua X · Ana');
    const s = store.getState();
    expect(s).toMatchObject({ activityId: 'a1', label: 'Rua X · Ana', status: 'pronta', truncated: false, error: null });
    expect(s.points).toHaveLength(4);
    // 2 trechos de ~111 m cada; entre eles nao se mede nada
    expect(s.meters).toBeGreaterThan(200);
    expect(s.meters).toBeLessThan(240);
    expect(seen[0]).toBe('baixando');
    expect(bounds).toEqual([[-23, -46, -22.997, -46]]);
  });

  it('esconder limpa tudo e uma carga em andamento deixa de valer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = {
      async trackPage() {
        await gate;
        return { points: [pt(0)], last: { ts: '1', id: 'p000' } };
      },
    } as unknown as AdminApi;
    const bounds: unknown[] = [];
    const store = createRemoteTrackStore({ api: () => slow, onReady: (b) => bounds.push(b) });
    const loading = store.show('a1', 'X');
    expect(store.getState().status).toBe('baixando');
    store.hide();
    expect(store.getState()).toMatchObject({ status: 'oculta', activityId: null, points: [] });
    release();
    await loading;
    expect(store.getState().status).toBe('oculta'); // a resposta atrasada nao reabre a trilha
    expect(bounds).toEqual([]);
  });

  it('pedir outra atividade enquanto baixa: so a ultima vale', async () => {
    const calls: string[] = [];
    const api = {
      async trackPage(a: string, _l: number, after?: TrackCursor) {
        calls.push(a);
        if (after) return { points: [], last: null };
        await new Promise((r) => setTimeout(r, a === 'a1' ? 20 : 1));
        return { points: [pt(a === 'a1' ? 1 : 2)], last: { ts: '1', id: a } };
      },
    } as unknown as AdminApi;
    const store = createRemoteTrackStore({ api: () => api });
    const first = store.show('a1', 'Um');
    const second = store.show('a2', 'Dois');
    await Promise.all([first, second]);
    expect(store.getState()).toMatchObject({ activityId: 'a2', label: 'Dois', status: 'pronta' });
    expect(store.getState().points.map((p) => p.id)).toEqual(['p002']);
  });

  it('erro de rede: mostra o texto em portugues e permite tentar de novo', async () => {
    let fail = true;
    const api = {
      async trackPage() {
        if (fail) throw new AdminError('network');
        return { points: [], last: null };
      },
    } as unknown as AdminApi;
    const store = createRemoteTrackStore({ api: () => api });
    await store.show('a1', 'X');
    expect(store.getState()).toMatchObject({ status: 'erro', activityId: 'a1' });
    expect(store.getState().error).toMatch(/internet/i);
    fail = false;
    await store.show('a1', 'X');
    expect(store.getState()).toMatchObject({ status: 'pronta', points: [], error: null });
  });

  it('sem servidor configurado: erro claro, sem quebrar', async () => {
    const store = createRemoteTrackStore({ api: () => null });
    await store.show('a1', 'X');
    expect(store.getState()).toMatchObject({ status: 'erro' });
  });
});
