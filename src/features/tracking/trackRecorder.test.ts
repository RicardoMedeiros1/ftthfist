import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RotaFibraDB, SETTING_KEYS } from '../../db/db';
import { distanceMeters } from '../../lib/geo';
import { createTrackRecorder, elapsedMs, type GeoLike } from './trackRecorder';
import { trackRepo } from './trackRepo';

const settle = () => new Promise((r) => setTimeout(r, 15));
const A = { lat: -23.55, lng: -46.63 };
const north = (m: number) => ({ lat: A.lat + m / 111_194.9266, lng: A.lng });

function setup(opts: { wake?: 'ativo' | 'indisponivel'; geo?: boolean; database?: RotaFibraDB; startAt?: number } = {}) {
  let t = opts.startAt ?? 1_000_000;
  const watchers: { ok: Parameters<GeoLike['watchPosition']>[0]; err: Parameters<GeoLike['watchPosition']>[1]; opts: PositionOptions }[] = [];
  const cleared: number[] = [];
  const geo: GeoLike = {
    watchPosition: (ok, err, o) => (watchers.push({ ok, err, opts: o }), watchers.length),
    clearWatch: (id) => void cleared.push(id),
  };
  let hidden = false;
  const visCbs = new Set<() => void>();
  const wake = { acquire: vi.fn(async () => opts.wake ?? ('ativo' as const)), release: vi.fn(async () => undefined) };
  const database = opts.database ?? new RotaFibraDB(`test-${crypto.randomUUID()}`);
  const rec = createTrackRecorder({
    database,
    geo: opts.geo === false ? null : geo,
    now: () => t,
    wakeLock: wake,
    visibility: { isHidden: () => hidden, onChange: (cb) => (visCbs.add(cb), () => visCbs.delete(cb)) },
    technician: async () => 'Carlos',
  });
  return {
    rec, database, wake, watchers, cleared, repo: trackRepo(database),
    advance: (ms: number) => { t += ms; },
    now: () => t,
    /** Entrega uma leitura do GPS ao último watch registrado. */
    fix(p: { lat: number; lng: number }, accuracy = 8, dt = 1000, speed: number | null = null) {
      t += dt;
      watchers[watchers.length - 1]!.ok({ coords: { latitude: p.lat, longitude: p.lng, accuracy, speed }, timestamp: t });
    },
    setHidden(h: boolean) { hidden = h; visCbs.forEach((cb) => cb()); },
    saved: async () => (await database.settings.get(SETTING_KEYS.trackState))?.value as Record<string, unknown> | undefined,
  };
}

let h: ReturnType<typeof setup>;
beforeEach(async () => {
  h = setup();
  await h.database.open();
});

describe('iniciar', () => {
  it('liga o GPS em alta precisão, segura a tela e guarda o estado', async () => {
    await h.rec.start('a1');
    const s = h.rec.getState();
    expect(s).toMatchObject({ status: 'gravando', activityId: 'a1', segment: 0, wakeLock: 'ativo', message: null });
    expect(h.watchers).toHaveLength(1);
    expect(h.watchers[0]!.opts).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    expect(h.wake.acquire).toHaveBeenCalledTimes(1);
    expect(await h.saved()).toMatchObject({ status: 'gravando', activityId: 'a1' });
  });

  it('iniciar de novo com uma gravação em andamento não cria um segundo GPS', async () => {
    await h.rec.start('a1');
    await h.rec.start('a1');
    expect(h.watchers).toHaveLength(1);
  });

  it('sem geolocalização no aparelho: avisa e não grava', async () => {
    const x = setup({ geo: false });
    await x.database.open();
    await x.rec.start('a1');
    expect(x.rec.getState()).toMatchObject({ status: 'parada' });
    expect(x.rec.getState().message).toContain('não oferece geolocalização');
  });

  it('navegador sem Wake Lock: a gravação funciona e o estado avisa que a tela não fica presa', async () => {
    const x = setup({ wake: 'indisponivel' });
    await x.database.open();
    await x.rec.start('a1');
    expect(x.rec.getState()).toMatchObject({ status: 'gravando', wakeLock: 'indisponivel' });
  });

  it('continua uma atividade que já tinha trilha: novo trecho e distância acumulada', async () => {
    await h.repo.add({ activityId: 'a1', ...A, accuracy: 5, timestamp: 1, segment: 0 }, 'C');
    await h.repo.add({ activityId: 'a1', ...north(100), accuracy: 5, timestamp: 2, segment: 0 }, 'C');
    await h.rec.start('a1');
    expect(h.rec.getState()).toMatchObject({ segment: 1, points: 2 });
    expect(h.rec.getState().distanceM).toBeCloseTo(100, 0);
  });
});

describe('gravar pontos', () => {
  it('aplica os filtros: ruim e perto do anterior são descartados', async () => {
    await h.rec.start('a1');
    h.fix(A, 50);              // impreciso (> 30 m)
    h.fix(A, 10);              // 1º ponto aceito
    h.fix(north(3), 10);       // a 3 m do anterior: descartado
    h.fix(north(20), 10);      // aceito
    h.fix(north(22), 90);      // impreciso
    h.fix(north(60), 30);      // aceito (30 m ainda vale)
    await settle();
    const pts = await h.repo.listFor('a1');
    expect(pts).toHaveLength(3);
    expect(h.rec.getState().points).toBe(3);
    expect(h.rec.getState().distanceM).toBeCloseTo(distanceMeters(A, north(60)), 0);
    expect(h.rec.getState().lastAccuracy).toBe(30);
  });

  it('cada ponto leva atividade, técnico, trecho, precisão, horário e velocidade quando existe', async () => {
    await h.rec.start('a1');
    h.fix(A, 7, 1000, 1.25);
    h.fix(north(30), 9, 1000, null);
    await settle();
    const [a, b] = await h.repo.listFor('a1');
    expect(a).toMatchObject({ activityId: 'a1', createdBy: 'Carlos', segment: 0, accuracy: 7, speed: 1.25, syncStatus: 'pending', deleted: false });
    expect(b && 'speed' in b).toBe(false);
    expect(b!.timestamp).toBeGreaterThan(a!.timestamp);
  });

  it('duas leituras seguidas no mesmo lugar não passam juntas pelo filtro dos 5 m', async () => {
    await h.rec.start('a1');
    h.fix(A, 8, 0);
    h.fix(A, 8, 0); // chega antes de o 1º terminar de gravar
    await settle();
    expect(await h.repo.listFor('a1')).toHaveLength(1);
  });

  it('o tempo só conta enquanto grava', async () => {
    await h.rec.start('a1');
    h.advance(10_000);
    expect(elapsedMs(h.rec.getState(), h.now())).toBe(10_000);
    h.advance(5_000);
    expect(elapsedMs(h.rec.getState(), h.now())).toBe(15_000);
  });
});

describe('pausar e retomar', () => {
  it('pausar para o GPS e solta a tela; o tempo congela', async () => {
    await h.rec.start('a1');
    h.advance(8_000);
    await h.rec.pause();
    expect(h.rec.getState().status).toBe('pausada');
    expect(h.cleared).toEqual([1]);
    expect(h.wake.release).toHaveBeenCalled();
    h.advance(60_000);
    expect(elapsedMs(h.rec.getState(), h.now())).toBe(8_000);
  });

  it('leituras que chegam depois de pausar são ignoradas', async () => {
    await h.rec.start('a1');
    await h.rec.pause();
    h.fix(north(50), 5); // o navegador entregou uma leitura atrasada
    await settle();
    expect(await h.repo.listFor('a1')).toHaveLength(0);
  });

  it('retomar abre um trecho novo e o primeiro ponto entra mesmo perto do último', async () => {
    await h.rec.start('a1');
    h.fix(A, 8);
    await h.rec.pause();
    await h.rec.resume();
    expect(h.rec.getState()).toMatchObject({ status: 'gravando', segment: 1 });
    expect(h.watchers).toHaveLength(2);
    h.fix(north(1), 8); // 1 m do último ponto do trecho anterior
    await settle();
    const pts = await h.repo.listFor('a1');
    expect(pts.map((p) => p.segment)).toEqual([0, 1]);
  });

  it('o tempo continua somando depois de retomar', async () => {
    await h.rec.start('a1');
    h.advance(10_000);
    await h.rec.pause();
    h.advance(120_000);
    await h.rec.resume();
    h.advance(5_000);
    expect(elapsedMs(h.rec.getState(), h.now())).toBe(15_000);
  });

  it('só pausa quem está gravando e só retoma quem está pausado', async () => {
    await h.rec.pause();
    await h.rec.resume();
    expect(h.rec.getState().status).toBe('parada');
  });
});

describe('encerrar', () => {
  it('para o GPS, solta a tela, limpa o estado salvo e mantém os pontos', async () => {
    await h.rec.start('a1');
    h.fix(A, 8);
    h.fix(north(30), 8);
    await settle();
    await h.rec.stop();
    expect(h.rec.getState()).toMatchObject({ status: 'parada', activityId: null });
    expect(h.cleared).toEqual([1]);
    expect(h.wake.release).toHaveBeenCalled();
    expect(await h.saved()).toBeUndefined();
    expect(await h.repo.listFor('a1')).toHaveLength(2);
  });

  it('concluir a atividade (ou trocar a aberta) encerra a gravação com aviso', async () => {
    await h.rec.start('a1');
    await h.rec.syncActivity('a1');
    expect(h.rec.getState().status).toBe('gravando'); // a mesma atividade continua aberta
    await h.rec.syncActivity(null);
    expect(h.rec.getState()).toMatchObject({ status: 'parada' });
    expect(h.rec.getState().message).toContain('atividade foi concluída');
    await h.rec.start('a2');
    await h.rec.syncActivity('a3');
    expect(h.rec.getState().status).toBe('parada');
  });
});

describe('tela apagada (limitação de PWA)', () => {
  it('ao apagar a tela o tempo congela; ao voltar abre um trecho novo e avisa', async () => {
    await h.rec.start('a1');
    h.fix(A, 8, 5_000);
    h.setHidden(true);
    expect(h.rec.getState().suspended).toBe(true);
    h.advance(60_000); // tela apagada por 1 minuto
    h.fix(north(200), 5, 0); // leitura que o navegador entregou mesmo assim: ignorada
    await settle();
    expect(await h.repo.listFor('a1')).toHaveLength(1);
    expect(elapsedMs(h.rec.getState(), h.now())).toBe(5_000);

    h.setHidden(false);
    const s = h.rec.getState();
    expect(s).toMatchObject({ suspended: false, segment: 1, status: 'gravando' });
    expect(s.message).toContain('A tela apagou');
    expect(h.watchers).toHaveLength(2); // o GPS foi religado
    expect(h.wake.acquire).toHaveBeenCalledTimes(2); // a tela é segurada de novo
    h.advance(4_000);
    expect(elapsedMs(h.rec.getState(), h.now())).toBe(9_000); // o minuto apagado não conta
  });

  it('a trilha não liga os dois lados do intervalo com uma linha reta', async () => {
    await h.rec.start('a1');
    h.fix(A, 8);
    h.fix(north(30), 8);
    h.setHidden(true);
    h.setHidden(false);
    h.fix(north(500), 8);
    h.fix(north(530), 8);
    await settle();
    const { trackDistanceMeters } = await import('./trackStats');
    const pts = await h.repo.listFor('a1');
    expect(pts.map((p) => p.segment)).toEqual([0, 0, 1, 1]);
    expect(trackDistanceMeters(pts)).toBeCloseTo(60, 0); // 30 + 30; o salto de 470 m não entra
  });

  it('esconder e mostrar sem estar gravando não faz nada', async () => {
    h.setHidden(true);
    h.setHidden(false);
    expect(h.rec.getState().status).toBe('parada');
  });

  it('pausado durante a tela apagada: voltar não retoma sozinho', async () => {
    await h.rec.start('a1');
    await h.rec.pause();
    h.setHidden(true);
    h.setHidden(false);
    expect(h.rec.getState().status).toBe('pausada');
  });
});

describe('permissão e erros do GPS', () => {
  it('permissão negada encerra a gravação com aviso', async () => {
    await h.rec.start('a1');
    h.watchers[0]!.err({ code: 1 });
    await settle();
    expect(h.rec.getState().status).toBe('parada');
    expect(h.rec.getState().message).toContain('Permissão de localização negada');
  });

  it('sinal fraco ou timeout não encerram: o GPS volta sozinho', async () => {
    await h.rec.start('a1');
    h.watchers[0]!.err({ code: 2 });
    h.watchers[0]!.err({ code: 3 });
    await settle();
    expect(h.rec.getState().status).toBe('gravando');
  });
});

describe('app fechado ou recarregado no meio da gravação', () => {
  it('volta pausado, com o tempo até a última leitura recebida, e avisa', async () => {
    await h.rec.start('a1');
    h.fix(A, 8, 12_000);          // grava o estado (passou o intervalo de 10 s)
    h.fix(north(30), 8, 3_000);   // depois disso o app foi fechado: esses 3 s ficam sem registro de estado
    await settle();

    // "reabrir o app": outro gravador sobre o mesmo banco
    const b = setup({ database: h.database, startAt: h.now() + 600_000 });
    await b.rec.hydrate();
    const s = b.rec.getState();
    expect(s).toMatchObject({ status: 'pausada', activityId: 'a1', segment: 0, points: 2 });
    expect(s.message).toContain('interrompida');
    expect(s.activeMs).toBeGreaterThanOrEqual(12_000);
    expect(s.activeMs).toBeLessThanOrEqual(15_000); // nunca inventa os 10 minutos em que o app esteve fechado
    expect(b.watchers).toHaveLength(0);   // não liga o GPS sozinho
    expect(s.distanceM).toBeCloseTo(30, 0);

    await b.rec.resume();
    expect(b.rec.getState()).toMatchObject({ status: 'gravando', segment: 1 });
  });

  it('uma gravação pausada volta pausada, sem aviso de interrupção', async () => {
    await h.rec.start('a1');
    h.advance(20_000);
    await h.rec.pause();
    const b = setup({ database: h.database });
    await b.rec.hydrate();
    expect(b.rec.getState()).toMatchObject({ status: 'pausada', activeMs: 20_000, message: null });
  });

  it('sem gravação salva, ou com lixo salvo, não faz nada', async () => {
    const b = setup({ database: h.database });
    await b.rec.hydrate();
    expect(b.rec.getState().status).toBe('parada');
    await h.database.settings.put({ key: SETTING_KEYS.trackState, value: { status: 'gravando', lixo: 1 } });
    await b.rec.hydrate();
    expect(b.rec.getState().status).toBe('parada');
  });

  it('depois de encerrar, reabrir o app não ressuscita a gravação', async () => {
    await h.rec.start('a1');
    await h.rec.stop();
    const b = setup({ database: h.database });
    await b.rec.hydrate();
    expect(b.rec.getState().status).toBe('parada');
  });
});
