import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '../../db/db';
import type { NetworkElement } from '../../db/types';
import { setActingUser } from '../../lib/ownership';
import { activityRepo } from '../activities/activityRepo';
import { elementRepo } from '../elements/elementRepo';
import { CycleAbort, createSyncEngine, type Role, type Tuning } from './engine';
import { SyncHttpError } from './remote';
import { Device, fieldWork, pole } from './testDevice';
import { TestServer } from './testServer';

const dev = (userId: string, role: Role = 'tecnico', tuning: Partial<Tuning> = {}) => new Device(server.client(userId), userId, role, tuning);

let server: TestServer;
let ana: Device;
let ana2: Device; // segundo aparelho da Ana
let bia: Device;
beforeEach(async () => {
  server = new TestServer();
  server.addUser('ana');
  server.addUser('bia');
  ana = await dev('ana').open();
  ana2 = await dev('ana').open();
  bia = await dev('bia').open();
});
afterEach(() => setActingUser(null));

const pendingCount = async (d: Device) => (await d.counts()).pending;

describe('enviar', () => {
  it('sobe atividade, elementos, cabo e trilha, e marca tudo como enviado', async () => {
    await fieldWork(ana);
    expect(await pendingCount(ana)).toBe(1 + 2 + 1 + 3);
    const report = await ana.sync();
    expect(report.pushed).toBe(7);
    expect(await pendingCount(ana)).toBe(0);
    expect([server.count('activities'), server.count('elements'), server.count('cables'), server.count('track_points')]).toEqual([1, 2, 1, 3]);
    expect([...server.rows.elements!.values()].every((r) => r.owner_id === 'ana')).toBe(true);
  });

  it('o que sobe é o que o app tem: campos traduzidos e donos definidos pelo servidor', async () => {
    const { cable, p1 } = await fieldWork(ana);
    await ana.sync();
    const c = server.get('cables', cable.id)!;
    expect(c).toMatchObject({ cable_type: 'AS-80', fiber_count: 12, owner_id: 'ana', deleted: false });
    expect(c.length_m).toBe(cable.lengthMeters);
    expect(c.vertices).toEqual(cable.vertices);
    const e = server.get('elements', p1.id)!;
    expect(e).toMatchObject({ type: 'poste', lat: p1.lat, lng: p1.lng, accuracy_m: 4, position_source: 'gps' });
    expect(e).not.toHaveProperty('geom');
  });

  it('sem nada novo, o ciclo seguinte não envia nem uma linha (reenviar nunca é necessário)', async () => {
    await fieldWork(ana);
    await ana.sync();
    server.calls.length = 0;
    const r = await ana.sync();
    expect(r.pushed).toBe(0);
    expect(server.calls.filter((c) => c.fn === 'upsert')).toEqual([]);
  });

  it('lote grande é dividido em partes', async () => {
    const small = await dev('ana', 'tecnico', { pushBatch: 2, trackBatch: 2 }).open();
    await fieldWork(small);
    await small.sync();
    const upserts = server.calls.filter((c) => c.fn === 'upsert');
    expect(upserts.map((c) => `${c.table}:${c.n}`)).toEqual(['activities:1', 'elements:2', 'cables:1', 'track_points:2', 'track_points:1']);
  });

  it('ordem: a atividade sobe antes dos registros que dependem dela', async () => {
    await fieldWork(ana);
    await ana.sync();
    expect(server.calls.filter((c) => c.fn === 'upsert').map((c) => c.table)).toEqual(['activities', 'elements', 'cables', 'track_points']);
  });

  it('só o que mudou desde o último envio volta a subir', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await ana.as(() => ana.els.update(p1.id, { code: 'P-77' }));
    expect(await pendingCount(ana)).toBe(1);
    server.calls.length = 0;
    const r = await ana.sync();
    expect(r.pushed).toBe(1);
    expect(server.calls.filter((c) => c.fn === 'upsert').map((c) => `${c.table}:${c.n}`)).toEqual(['elements:1']);
    expect(server.get('elements', p1.id)?.code).toBe('P-77');
  });

  it('exclusão lógica sobe como deleted = true (a linha continua no servidor)', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await ana.as(() => ana.els.remove(p1.id));
    await ana.sync();
    expect(server.get('elements', p1.id)).toMatchObject({ deleted: true });
    expect(server.count('elements')).toBe(2);
  });
});

describe('falhas de rede', () => {
  it('sem internet: o ciclo para com "network" e NADA se perde nem é marcado como enviado', async () => {
    await fieldWork(ana);
    server.down = true;
    const e = await ana.sync().then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(CycleAbort);
    expect((e as CycleAbort).reason).toBe('network');
    expect(await pendingCount(ana)).toBe(7);
    server.down = false;
    await ana.sync();
    expect(await pendingCount(ana)).toBe(0);
  });

  it('a resposta se perdeu depois de o servidor gravar: tentar de novo NÃO duplica', async () => {
    const { act } = await fieldWork(ana);
    server.loseResponseOnce = true;
    await expect(ana.sync()).rejects.toBeInstanceOf(CycleAbort);
    expect(server.count('activities')).toBe(1); // o servidor gravou, o aparelho não ficou sabendo
    expect(await pendingCount(ana)).toBe(7);
    const r = await ana.sync();
    expect(await pendingCount(ana)).toBe(0);
    expect([server.count('activities'), server.count('elements'), server.count('cables'), server.count('track_points')]).toEqual([1, 2, 1, 3]);
    expect(r.lostEdits).toBe(0); // reenvio igual não é conflito
    expect(server.conflicts).toEqual([]);
    expect(server.get('activities', act.id)?.owner_id).toBe('ana');
  });

  it('queda no meio: o que já subiu fica enviado e o resto sobe no próximo ciclo', async () => {
    await fieldWork(ana);
    let n = 0;
    server.beforeRespond = () => {
      if (++n === 2) server.down = true; // cai depois do 2º lote
    };
    await expect(ana.sync()).rejects.toBeInstanceOf(CycleAbort);
    const left = await pendingCount(ana);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(7);
    server.down = false;
    server.beforeRespond = null;
    await ana.sync();
    expect(await pendingCount(ana)).toBe(0);
  });

  it('sessão vencida (401): para com "auth" e nada é bloqueado', async () => {
    await fieldWork(ana);
    server.failNext = new SyncHttpError('auth', 'JWT expired', 401, 'PGRST301');
    const e = await ana.sync().then(() => null, (x: unknown) => x);
    expect((e as CycleAbort).reason).toBe('auth');
    expect(await ana.counts()).toEqual({ pending: 7, blocked: 0 });
  });

  it('erro 503 do servidor: tenta depois, sem culpar nenhum registro', async () => {
    await fieldWork(ana);
    server.failNext = new SyncHttpError('transient', 'Service Unavailable', 503, '');
    const e = await ana.sync().then(() => null, (x: unknown) => x);
    expect((e as CycleAbort).reason).toBe('server');
    expect(await ana.counts()).toEqual({ pending: 7, blocked: 0 });
  });
});

describe('registro que o servidor recusa', () => {
  it('um registro ruim no lote não trava os outros: ele fica bloqueado e os demais sobem', async () => {
    const { act } = await fieldWork(ana);
    const els = await ana.as(async () => {
      const out: NetworkElement[] = [];
      for (let i = 2; i < 6; i++) out.push(await ana.els.create(pole(i), 'ana'));
      return out;
    });
    await ana.db.elements.update(els[1]!.id, { lat: 999 }); // coordenada impossível
    const r = await ana.sync();
    expect(r.newlyBlocked).toBe(1);
    expect(server.count('elements')).toBe(2 + 3);
    expect(server.get('elements', els[1]!.id)).toBeUndefined();
    const c = await ana.counts();
    expect(c.blocked).toBe(1);
    expect(c.pending).toBe(0);
    const list = await ana.engine.blockedList(ana.who);
    expect(list).toMatchObject([{ table: 'elements', id: els[1]!.id }]);
    expect(act.id).toBeTruthy();
  });

  it('o bloqueado não é reenviado a cada ciclo; corrigir o registro o libera', async () => {
    await fieldWork(ana);
    const bad = await ana.as(() => ana.els.create(pole(9), 'ana'));
    await ana.db.elements.update(bad.id, { lat: 999 });
    await ana.sync();
    server.calls.length = 0;
    await ana.sync();
    expect(server.calls.filter((c) => c.fn === 'upsert')).toEqual([]); // não tenta de novo
    await ana.as(() => ana.els.move(bad.id, { lat: -23.56, lng: -46.64, positionSource: 'manual' }));
    const r = await ana.sync();
    expect(r.pushed).toBe(1);
    expect(server.get('elements', bad.id)).toMatchObject({ lat: -23.56 });
    expect(await ana.counts()).toEqual({ pending: 0, blocked: 0 });
  });

  it('"tentar de novo" esquece os bloqueios', async () => {
    await fieldWork(ana);
    const bad = await ana.as(() => ana.els.create(pole(9), 'ana'));
    await ana.db.elements.update(bad.id, { type: 'xyz' as never });
    await ana.sync();
    expect((await ana.counts()).blocked).toBe(1);
    await ana.engine.clearBlocked();
    expect(await ana.counts()).toEqual({ pending: 1, blocked: 0 });
  });

  it('muitos recusados no mesmo ciclo: para (provável problema de conta, não dos dados)', async () => {
    await fieldWork(ana);
    const many = await ana.as(async () => {
      const out: NetworkElement[] = [];
      for (let i = 2; i < 12; i++) out.push(await ana.els.create(pole(i), 'ana'));
      return out;
    });
    for (const e of many) await ana.db.elements.update(e.id, { lat: 999 });
    const err = await ana.sync().then(() => null, (x: unknown) => x);
    expect((err as CycleAbort).reason).toBe('too-many-blocked');
    expect(server.count('track_points')).toBe(0); // nem chegou na trilha
  });

  it('atividade recusada: os registros dela esperam em vez de falhar um a um', async () => {
    const { act } = await fieldWork(ana);
    await ana.db.activities.update(act.id, { kind: 'xyz' as never });
    server.rows.activities!.clear();
    // o servidor falso aceita qualquer atividade; simula a recusa por regra de papel desativando o perfil
    server.failNext = new SyncHttpError('permanent', 'check constraint', 400, '23514');
    const r = await ana.sync();
    expect(r.newlyBlocked).toBe(1);
    expect(server.count('elements') + server.count('cables') + server.count('track_points')).toBe(0);
    // nem tentou enviar os registros dela: esperam a atividade (não geram uma recusa por registro)
    expect(server.calls.filter((c) => c.fn === 'upsert' && c.table !== 'activities')).toEqual([]);
    expect(await ana.counts()).toEqual({ pending: 6, blocked: 1 });
  });

  it('registro que depende de outro ainda ausente espera sem ser bloqueado', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    // o servidor "esquece" a atividade (ex.: outro aparelho dela ainda não subiu): o elemento novo espera
    server.rows.activities!.clear();
    await ana.as(() => ana.els.update(p1.id, { code: 'P-1' }));
    const r = await ana.sync();
    expect(r.waiting).toBe(1);
    expect(await ana.counts()).toEqual({ pending: 1, blocked: 0 });
  });
});

describe('só o dono envia', () => {
  it('registro pendente de outra pessoa nunca é enviado por este aparelho', async () => {
    await fieldWork(ana);
    // a Bia loga no aparelho da Ana
    const asBia = createSyncEngine({ db: ana.db, remote: server.client('bia'), now: Date.now });
    const r = await asBia.runCycle({ userId: 'bia', role: 'tecnico' });
    expect(r.pushed).toBe(0);
    expect(server.count('activities')).toBe(0);
    expect(await asBia.counts({ userId: 'bia', role: 'tecnico' })).toEqual({ pending: 0, blocked: 0 });
  });

  it('escritório não envia (só baixa), mesmo com registro pendente no aparelho', async () => {
    await fieldWork(ana);
    await ana.sync();
    server.addUser('clara', 'escritorio');
    const clara = await dev('clara', 'escritorio').open();
    await fieldWork(clara, 'Clara'); // algo pendente no aparelho dela
    server.calls.length = 0;
    const r = await clara.sync();
    expect(r.pushed).toBe(0);
    expect(server.calls.filter((c) => c.fn === 'upsert')).toEqual([]);
    expect(r.pulled).toBe(1 + 2 + 1);
    expect(await clara.counts()).toEqual({ pending: 0, blocked: 0 }); // nao ha o que "esperar enviar"
  });
});

describe('baixar', () => {
  it('a Bia recebe o que a Ana fez, marcado como enviado e com o dono certo', async () => {
    const { act, p1, cable } = await fieldWork(ana, 'Ana');
    await ana.sync();
    const r = await bia.sync();
    expect(r.pulled).toBe(1 + 2 + 1);
    expect((await bia.db.activities.get(act.id))?.ownerId).toBe('ana');
    expect(await bia.db.elements.get(p1.id)).toMatchObject({ ownerId: 'ana', syncStatus: 'synced', lat: p1.lat, accuracy: 4 });
    expect(await bia.db.cables.get(cable.id)).toMatchObject({ ownerId: 'ana', lengthMeters: cable.lengthMeters, vertices: cable.vertices });
    expect(await pendingCount(bia)).toBe(0); // baixar não gera pendência
  });

  it('a trilha da Ana NÃO vai para o aparelho da Bia', async () => {
    await fieldWork(ana);
    await ana.sync();
    await bia.sync();
    expect(await bia.db.trackPoints.count()).toBe(0);
    expect(server.calls.some((c) => c.fn === 'pull' && c.table === 'track_points')).toBe(false);
  });

  it('o que a Bia recebeu é somente leitura para ela', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await bia.sync();
    const err = await bia.as(() => bia.els.update(p1.id, { code: 'X' })).then(() => null, (e: { code: string }) => e);
    expect(err?.code).toBe('NOT_OWNER');
  });

  it('mudança da Ana chega à Bia no ciclo seguinte (incremental)', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await bia.sync();
    await ana.as(() => ana.els.update(p1.id, { code: 'P-NOVO' }));
    await ana.sync();
    const r = await bia.sync();
    expect(r.pulled).toBeGreaterThanOrEqual(1);
    expect((await bia.db.elements.get(p1.id))?.code).toBe('P-NOVO');
  });

  it('exclusão da Ana chega como "excluído" (some das listas da Bia)', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await bia.sync();
    await ana.as(() => ana.els.remove(p1.id));
    await ana.sync();
    await bia.sync();
    expect((await bia.db.elements.get(p1.id))?.deleted).toBe(true);
    expect((await bia.as(() => bia.els.list())).map((e) => e.id)).not.toContain(p1.id);
  });

  it('o cursor avança e guarda o texto do servidor (microssegundos intactos)', async () => {
    await fieldWork(ana);
    await ana.sync();
    await bia.sync();
    const cur = (await bia.db.settings.get(SETTING_KEYS.syncCursor))?.value as Record<string, string>;
    expect(cur.activities).toBe(String(server.get('activities', [...server.rows.activities!.keys()][0]!)!.server_updated_at));
    expect(cur.activities).toMatch(/\.\d{6}\+00:00$/);
  });

  it('volta 5 minutos no cursor (sobreposição), sem baixar de novo o que ficou mais antigo que isso', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await bia.sync();
    server.clock += 10 * 60_000; // 10 min depois
    await ana.as(() => ana.els.update(p1.id, { code: 'P-DEPOIS' }));
    await ana.sync();
    await bia.sync(); // traz a mudança nova; o cursor de "elementos" passa a ser o dela

    // contagem por tabela do que o servidor devolveu neste ciclo
    const got: Record<string, number> = {};
    const remote = server.client('bia');
    const spy = createSyncEngine({ db: bia.db, remote: { ...remote, pull: async (t, q) => { const rows = await remote.pull(t, q); got[t] = (got[t] ?? 0) + rows.length; return rows; } }, now: Date.now });
    const before = (await bia.db.settings.get(SETTING_KEYS.syncCursor))!.value as Record<string, string>;
    server.calls.length = 0;
    await spy.runCycle(bia.who);
    // o poste P-2 (10 min mais velho que o cursor) não volta; só o que está dentro da janela (o próprio P-1, no cursor)
    expect(got.elements).toBe(1);
    const since = server.calls.find((c) => c.fn === 'pull' && c.table === 'elements')!.query!.since;
    expect(Date.parse(since)).toBe(Math.floor(Date.parse(before.elements!)) - 5 * 60_000);
  });

  it('dentro da janela de sobreposição, o reenvio é inofensivo (sem duplicar nem sobrescrever)', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await bia.sync();
    const r = await bia.sync(); // tudo ainda dentro dos 5 min
    expect(r.pulled).toBe(1 + 2 + 1);
    expect(await bia.db.elements.where('id').equals(p1.id).count()).toBe(1);
  });

  it('páginas: baixa tudo mesmo quando passa de uma página', async () => {
    await fieldWork(ana);
    await ana.as(async () => {
      for (let i = 2; i < 10; i++) await ana.els.create(pole(i), 'ana');
    });
    await ana.sync();
    const paged = await dev('bia', 'tecnico', { pullPage: 3 }).open();
    server.calls.length = 0;
    const r = await paged.sync();
    expect(await paged.db.elements.count()).toBe(10);
    expect(r.pulled).toBe(1 + 10 + 1);
    const pulls = server.calls.filter((c) => c.fn === 'pull' && c.table === 'elements');
    expect(pulls.length).toBe(4); // 3 + 3 + 3 + 1
    expect(pulls[1]!.query!.after).toBeDefined();
  });

  it('ciclo interrompido no meio do baixar: retoma sem perder nem repetir o que já estava salvo', async () => {
    await fieldWork(ana);
    await ana.as(async () => {
      for (let i = 2; i < 8; i++) await ana.els.create(pole(i), 'ana');
    });
    await ana.sync();
    const paged = await dev('bia', 'tecnico', { pullPage: 2 }).open();
    let n = 0;
    server.beforeRespond = null;
    const remote = server.client('bia');
    const flaky = createSyncEngine({
      db: paged.db,
      remote: { ...remote, pull: async (t, q) => { if (t === 'elements' && ++n === 3) throw new SyncHttpError('network', 'x'); return remote.pull(t, q); } },
      now: Date.now,
    }, { pullPage: 2 });
    await expect(flaky.runCycle(paged.who)).rejects.toBeInstanceOf(CycleAbort);
    expect(await paged.db.elements.count()).toBe(4); // as 2 primeiras páginas ficaram salvas
    await paged.sync();
    expect(await paged.db.elements.count()).toBe(8);
  });
});

describe('o mesmo técnico em dois aparelhos (conflito)', () => {
  const edit = (d: Device, table: 'elements', id: string, patch: Partial<NetworkElement>, updatedAt: number) =>
    d.db[table].update(id, { ...patch, updatedAt, syncStatus: 'pending' });

  it('vence a alteração mais recente, mesmo que chegue primeiro ou depois', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await ana2.sync();
    const t0 = (await ana.db.elements.get(p1.id))!.updatedAt;
    await edit(ana, 'elements', p1.id, { code: 'DO-APARELHO-1' }, t0 + 1000);
    await edit(ana2, 'elements', p1.id, { code: 'DO-APARELHO-2' }, t0 + 2000); // mais recente
    await ana2.sync();
    await ana.sync(); // chega atrasada: perde
    expect(server.get('elements', p1.id)?.code).toBe('DO-APARELHO-2');
    expect(server.conflicts.map((c) => c.id)).toEqual([p1.id]);
    // o aparelho que perdeu passa a mostrar a versão que valeu e deixa de ter pendência
    expect((await ana.db.elements.get(p1.id))?.code).toBe('DO-APARELHO-2');
    expect(await pendingCount(ana)).toBe(0);
  });

  it('avisa quantas alterações minhas foram substituídas', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await ana2.sync();
    const t0 = (await ana.db.elements.get(p1.id))!.updatedAt;
    await edit(ana, 'elements', p1.id, { code: 'A' }, t0 + 1000);
    await edit(ana2, 'elements', p1.id, { code: 'B' }, t0 + 2000);
    await ana2.sync();
    const r = await ana.sync();
    expect(r.lostEdits).toBe(1);
  });

  it('a alteração mais recente chega depois: ela vale e o outro aparelho a recebe', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await ana2.sync();
    const t0 = (await ana.db.elements.get(p1.id))!.updatedAt;
    await edit(ana, 'elements', p1.id, { code: 'ANTIGA' }, t0 + 1000);
    await edit(ana2, 'elements', p1.id, { code: 'NOVA' }, t0 + 2000);
    await ana.sync();
    await ana2.sync();
    expect(server.get('elements', p1.id)?.code).toBe('NOVA');
    await ana.sync();
    expect((await ana.db.elements.get(p1.id))?.code).toBe('NOVA');
    expect(server.conflicts).toEqual([]);
  });

  it('edição feita no aparelho DURANTE o envio não é marcada como enviada', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await ana.as(() => ana.els.update(p1.id, { code: 'V1' }));
    server.beforeRespond = async () => {
      server.beforeRespond = null;
      await new Promise((r) => setTimeout(r, 5));
      await ana.as(() => ana.els.update(p1.id, { code: 'V2' })); // técnico edita enquanto sobe
    };
    await ana.sync();
    expect(server.get('elements', p1.id)?.code).toBe('V1');
    expect((await ana.db.elements.get(p1.id))?.syncStatus).toBe('pending');
    await ana.sync();
    expect(server.get('elements', p1.id)?.code).toBe('V2');
    expect(await pendingCount(ana)).toBe(0);
  });

  it('relógio do aparelho adiantado: o servidor limita, e o aparelho não entra em loop de reenvio', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    const future = Date.now() + 3 * 3600_000; // 3 h adiantado
    await ana.db.elements.update(p1.id, { code: 'RELOGIO', updatedAt: future, syncStatus: 'pending' });
    await ana.sync();
    expect(Date.parse(String(server.get('elements', p1.id)?.updated_at))).toBeLessThanOrEqual(server.clock + 5 * 60_000);
    expect(await pendingCount(ana)).toBe(0);
    server.calls.length = 0;
    await ana.sync();
    expect(server.calls.filter((c) => c.fn === 'upsert')).toEqual([]);
  });
});

describe('dois técnicos na mesma rede', () => {
  it('cada um sobe o seu e os dois enxergam tudo', async () => {
    const a = await fieldWork(ana, 'Ana');
    const b = await fieldWork(bia, 'Bia');
    await ana.sync();
    await bia.sync();
    await ana.sync();
    expect((await ana.db.activities.get(b.act.id))?.ownerId).toBe('bia');
    expect((await bia.db.activities.get(a.act.id))?.ownerId).toBe('ana');
    expect(await ana.db.elements.count()).toBe(4);
    expect(await bia.db.elements.count()).toBe(4);
    expect(await pendingCount(ana)).toBe(0);
    expect(await pendingCount(bia)).toBe(0);
  });

  it('a Bia mexer no que baixou da Ana é impossível no app, e no servidor também (RLS)', async () => {
    const { p1 } = await fieldWork(ana);
    await ana.sync();
    await bia.sync();
    // força: edita direto no banco local da Bia, como um defeito/ataque, e tenta subir
    await bia.db.elements.update(p1.id, { code: 'HACK', updatedAt: Date.now() + 1000, syncStatus: 'pending', ownerId: undefined });
    const r = await bia.sync();
    expect(r.newlyBlocked).toBe(1); // o servidor recusou (dono é a Ana)
    expect(server.get('elements', p1.id)?.code).not.toBe('HACK');
  });
});

describe('primeira sincronização de um aparelho com dados antigos', () => {
  it('registros feitos antes de existir conta (sem dono) sobem em nome de quem entrou', async () => {
    setActingUser(null);
    const old = await dev('ana').open();
    const act = await activityRepo(old.db).create({ kind: 'manutencao', title: 'Antiga' }, 'Ana');
    const el = await elementRepo(old.db).create(pole(0), 'Ana');
    expect(act.ownerId).toBeUndefined();
    await old.sync();
    expect(server.get('activities', act.id)?.owner_id).toBe('ana');
    expect(server.get('elements', el.id)?.owner_id).toBe('ana');
    expect((await old.db.activities.get(act.id))?.ownerId).toBe('ana');
  });
});


describe('lista de recusados não cresce sem fim', () => {
  it('registro corrigido e enviado sai da lista guardada', async () => {
    await fieldWork(ana);
    const bad = await ana.as(() => ana.els.create(pole(9), 'ana'));
    await ana.db.elements.update(bad.id, { lat: 999 });
    await ana.sync();
    const stored = async () => Object.keys(((await ana.db.settings.get(SETTING_KEYS.syncBlocked))?.value ?? {}) as object);
    expect(await stored()).toHaveLength(1);
    await ana.as(() => ana.els.move(bad.id, { lat: -23.56, lng: -46.64, positionSource: 'manual' }));
    await ana.sync();
    expect(await stored()).toHaveLength(0);
  });
});
