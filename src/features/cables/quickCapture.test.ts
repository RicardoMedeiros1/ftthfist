import { describe, expect, it } from 'vitest';
import type { Fix } from '../elements/gpsCapture';
import { QUICK_GOOD_M, QUICK_LOOKBACK_MS, QUICK_MAX_MS, consistentBest, quickCapture } from './quickCapture';

const fix = (accuracy: number, receivedAt: number): Fix & { receivedAt: number } => ({
  lat: 0, lng: 0, accuracy, timestamp: receivedAt, receivedAt,
});

/** Relógio e espera falsos: cada `sleep` avança o tempo e libera as leituras agendadas. */
function harness(scheduled: [number, number][] = [], initial: [number, number][] = []) {
  let t = 10_000;
  const all: (Fix & { receivedAt: number })[] = initial.map(([dt, acc]) => fix(acc, t + dt));
  const pending = [...scheduled];
  return {
    feed: { recent: (since: number) => all.filter((f) => f.receivedAt >= since && f.receivedAt <= t) },
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      for (const [dt, acc] of pending.splice(0).filter(([d]) => 10_000 + d <= t) ) all.push(fix(acc, 10_000 + dt));
      pending.push(...scheduled.filter(([d]) => 10_000 + d > t));
    },
    elapsed: () => t - 10_000,
  };
}

describe('quickCapture', () => {
  it('leitura boa já recebida: responde na hora', async () => {
    const h = harness([], [[-500, 3]]);
    const r = await quickCapture(h.feed, { now: h.now, sleep: h.sleep });
    expect(r?.accuracy).toBe(3);
    expect(h.elapsed()).toBe(0);
  });

  it('usa leituras dos últimos 2 s antes do toque; ignora as mais antigas', async () => {
    const h = harness([], [[-QUICK_LOOKBACK_MS - 500, 2], [-1500, 9]]);
    const r = await quickCapture(h.feed, { now: h.now, sleep: h.sleep });
    expect(r?.accuracy).toBe(9); // a de 2 m era antiga demais
  });

  it('espera uma leitura boa chegar e encerra assim que chega (antes dos 4 s)', async () => {
    const h = harness([[1200, 4]], [[-300, 12]]);
    const r = await quickCapture(h.feed, { now: h.now, sleep: h.sleep });
    expect(r?.accuracy).toBe(4);
    expect(h.elapsed()).toBeGreaterThanOrEqual(1200);
    expect(h.elapsed()).toBeLessThan(QUICK_MAX_MS);
  });

  it('só leitura ruim: espera os 4 s e devolve a melhor delas', async () => {
    const h = harness([[1000, 20], [2500, 14]], [[-200, 30]]);
    const r = await quickCapture(h.feed, { now: h.now, sleep: h.sleep });
    expect(r?.accuracy).toBe(14);
    expect(h.elapsed()).toBeGreaterThanOrEqual(QUICK_MAX_MS);
  });

  it('sem nenhuma leitura devolve null depois dos 4 s', async () => {
    const h = harness();
    expect(await quickCapture(h.feed, { now: h.now, sleep: h.sleep })).toBeNull();
    expect(h.elapsed()).toBeGreaterThanOrEqual(QUICK_MAX_MS);
  });

  it('o limite de "boa o bastante" é inclusivo', async () => {
    const h = harness([], [[0, QUICK_GOOD_M]]);
    expect((await quickCapture(h.feed, { now: h.now, sleep: h.sleep }))?.accuracy).toBe(QUICK_GOOD_M);
    expect(h.elapsed()).toBe(0);
  });
});

describe('consistentBest (só leituras do lugar onde o técnico está agora)', () => {
  const at = (lat: number, lng: number, accuracy: number, timestamp: number): Fix => ({ lat, lng, accuracy, timestamp });

  it('leitura precisa do poste anterior (longe) não vence a leitura nova, mesmo pior', () => {
    const anterior = at(-23.55, -46.63, 3, 1000);
    const nova = at(-23.5513, -46.6314, 40, 2000); // ~190 m dali
    expect(consistentBest([anterior, nova])).toEqual(nova);
  });

  it('no mesmo lugar, a mais precisa vence mesmo sendo mais antiga', () => {
    const a = at(-23.55, -46.63, 4, 1000);
    const b = at(-23.55001, -46.63, 12, 2000); // ~1 m dali
    expect(consistentBest([a, b])).toEqual(a);
  });

  it('o raio é de pelo menos 10 m ou o erro da leitura mais recente', () => {
    const nova = at(-23.55, -46.63, 40, 2000);
    const a30m = at(-23.55027, -46.63, 5, 1000); // ~30 m: dentro dos 40 m de erro da nova
    expect(consistentBest([a30m, nova])).toEqual(a30m);
    const nova5 = at(-23.55, -46.63, 5, 2000);
    expect(consistentBest([a30m, nova5])).toEqual(nova5); // 30 m > max(10, 5)
  });

  it('lista vazia devolve null', () => expect(consistentBest([])).toBeNull());
});
