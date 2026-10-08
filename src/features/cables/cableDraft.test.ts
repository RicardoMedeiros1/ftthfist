import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTING_KEYS, db } from '../../db/db';
import {
  activeCable,
  cableDraftStore,
  cableLengthMeters,
  cableReserveMeters,
  cablesToSave,
  canFinishDraft,
  draftLengthMeters,
  draftReserveMeters,
  inBranch,
  openStack,
  readDraft,
} from './cableDraft';

const s = () => cableDraftStore.getState();
const trunk = () => s()!.cables[0]!;
const settle = () => new Promise((r) => setTimeout(r, 20)); // deixa a gravação assíncrona terminar

beforeEach(async () => {
  cableDraftStore.clear();
  await settle();
});

const A = { lat: -23.55, lng: -46.63 };
const B = { lat: -23.5503, lng: -46.6301 };
const C = { lat: -23.5506, lng: -46.6303 };
const D = { lat: -23.5509, lng: -46.6306 };

describe('rascunho do cabo', () => {
  it('começa vazio, com id próprio e as escolhas feitas', () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    expect(s()!.cables).toHaveLength(1);
    expect(trunk()).toMatchObject({ cableType: 'AS-80', fiberCount: 12, vertices: [] });
    expect(s()!.actions).toEqual([]);
    expect(trunk().cableId).toMatch(/^[0-9a-f-]{36}$/);
    expect(trunk().parentId).toBeUndefined();
    expect(canFinishDraft(s()!)).toBe(false);
  });

  it('guarda o padrão de cores só quando foi escolhido', () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    expect('colorStandard' in trunk()).toBe(false);
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12, colorStandard: 'tia598' });
    expect(trunk().colorStandard).toBe('tia598');
  });

  it('pontos entram na ordem; só pode finalizar com 2 ou mais', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    expect(canFinishDraft(s()!)).toBe(false);
    cableDraftStore.addVertex({ ...B });
    expect(canFinishDraft(s()!)).toBe(true);
    expect(trunk().vertices.map((v) => v.elementId)).toEqual(['p1', undefined]);
  });

  it('ignora o mesmo ponto em sequência (mesmo elemento ou mesma posição)', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    expect(cableDraftStore.addVertex({ elementId: 'p1', ...A })).toBe(true);
    expect(cableDraftStore.addVertex({ elementId: 'p1', lat: 9, lng: 9 })).toBe(false); // mesmo elemento
    expect(cableDraftStore.addVertex({ ...A })).toBe(false); // mesma posição
    expect(trunk().vertices).toHaveLength(1);
    expect(s()!.actions).toHaveLength(1);
    // o mesmo elemento de novo, mas depois de outro ponto, é permitido (cabo que volta)
    cableDraftStore.addVertex({ ...B });
    expect(cableDraftStore.addVertex({ elementId: 'p1', ...A })).toBe(true);
  });

  it('metragem do traçado e das reservas', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    cableDraftStore.addVertex(A);
    cableDraftStore.addVertex(B);
    cableDraftStore.addReserve('r1', 12.5);
    cableDraftStore.addVertex(C);
    cableDraftStore.addReserve('r2', 5);
    expect(draftReserveMeters(s()!)).toBe(17.5);
    expect(cableReserveMeters(s()!, trunk().cableId)).toBe(17.5);
    expect(draftLengthMeters(s()!)).toBeGreaterThan(30);
    expect(draftLengthMeters(s()!)).toBe(cableLengthMeters(trunk()));
  });

  it('desfazer volta uma ação por vez, na ordem inversa, e diz o que foi desfeito', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    const id = trunk().cableId;
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    cableDraftStore.addVertex({ elementId: 'p2', ...B }, 'p2');
    cableDraftStore.addReserve('r1', 10);

    expect(cableDraftStore.undo()).toEqual({ kind: 'reserve', cableId: id, elementId: 'r1', meters: 10 });
    expect(trunk().vertices).toHaveLength(2); // desfazer a reserva não mexe nos pontos
    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex', createdElementId: 'p2' });
    expect(trunk().vertices).toHaveLength(1);
    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex', createdElementId: 'p1' });
    expect(cableDraftStore.undo()).toBeNull();
    expect(trunk().vertices).toEqual([]);
  });

  it('ponto que não criou elemento (toque num existente ou solto) é desfeito sem apagar nada', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    cableDraftStore.addVertex({ elementId: 'velho', ...A }); // elemento que já existia
    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex' });
  });

  it('sem rascunho, as operações não fazem nada', () => {
    expect(cableDraftStore.addVertex(A)).toBe(false);
    expect(cableDraftStore.undo()).toBeNull();
    expect(cableDraftStore.branch({ cableType: 'drop', fiberCount: 1 })).toBeNull();
    expect(cableDraftStore.endBranch()).toBe(false);
  });
});

describe('ramais (lançar a rede toda de uma vez)', () => {
  const DROP = { cableType: 'drop', fiberCount: 2 };

  /** Tronco p1 → ceo1 (derivação), com o técnico parado na CEO. */
  function atJunction() {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    cableDraftStore.addVertex({ elementId: 'ceo1', ...B }, 'ceo1');
  }

  it('deriva do último ponto: o ramal começa no elemento e vira o cabo ativo', () => {
    atJunction();
    const id = cableDraftStore.branch(DROP)!;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s()!.cables).toHaveLength(2);
    const ramal = s()!.cables[1]!;
    expect(ramal).toMatchObject({ cableId: id, cableType: 'drop', fiberCount: 2, parentId: trunk().cableId });
    expect(ramal.vertices).toEqual([{ elementId: 'ceo1', ...B }]);
    expect(activeCable(s()!).cableId).toBe(id);
    expect(inBranch(s()!)).toBe(true);
    expect(openStack(s()!)).toEqual([trunk().cableId, id]);
    // o tronco não foi mexido
    expect(trunk().vertices).toHaveLength(2);
  });

  it('só deriva de um elemento: ponto solto, tronco vazio ou sem rascunho não derivam', () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    expect(cableDraftStore.branch(DROP)).toBeNull(); // nada marcado
    cableDraftStore.addVertex({ ...A }); // ponto solto
    expect(cableDraftStore.branch(DROP)).toBeNull();
    expect(s()!.cables).toHaveLength(1);
    expect(s()!.actions).toHaveLength(1);
  });

  it('os pontos e reservas seguintes vão para o ramal; ao terminar, voltam ao tronco', () => {
    atJunction();
    const id = cableDraftStore.branch(DROP)!;
    cableDraftStore.addVertex({ elementId: 'p2', ...C }, 'p2');
    cableDraftStore.addVertex({ elementId: 'cto1', ...D }, 'cto1');
    cableDraftStore.addReserve('r1', 8);
    expect(s()!.cables[1]!.vertices.map((v) => v.elementId)).toEqual(['ceo1', 'p2', 'cto1']);
    expect(trunk().vertices.map((v) => v.elementId)).toEqual(['p1', 'ceo1']);
    expect(cableReserveMeters(s()!, id)).toBe(8);
    expect(cableReserveMeters(s()!, trunk().cableId)).toBe(0);

    expect(cableDraftStore.endBranch()).toBe(true);
    expect(inBranch(s()!)).toBe(false);
    expect(activeCable(s()!).cableId).toBe(trunk().cableId);

    // o tronco continua a partir da CEO, sem repetir o ponto
    expect(cableDraftStore.addVertex({ elementId: 'ceo1', ...B })).toBe(false);
    expect(cableDraftStore.addVertex({ elementId: 'p3', lat: -23.551, lng: -46.631 }, 'p3')).toBe(true);
    expect(trunk().vertices.map((v) => v.elementId)).toEqual(['p1', 'ceo1', 'p3']);
    expect(s()!.cables[1]!.vertices).toHaveLength(3); // o ramal ficou como estava
  });

  it('não termina o ramal que só tem a derivação, nem fora de um ramal', () => {
    atJunction();
    expect(cableDraftStore.endBranch()).toBe(false); // no tronco
    cableDraftStore.branch(DROP);
    expect(cableDraftStore.endBranch()).toBe(false); // ramal sem nenhum ponto além da CEO
    cableDraftStore.addVertex({ ...C });
    expect(cableDraftStore.endBranch()).toBe(true);
    expect(cableDraftStore.endBranch()).toBe(false); // já voltou ao tronco
  });

  it('duas derivações da mesma CEO, uma depois da outra', () => {
    atJunction();
    const r1 = cableDraftStore.branch(DROP)!;
    cableDraftStore.addVertex({ ...C });
    cableDraftStore.endBranch();
    const r2 = cableDraftStore.branch({ cableType: 'drop', fiberCount: 1 })!;
    expect(r2).not.toBe(r1);
    expect(s()!.cables.map((c) => c.parentId)).toEqual([undefined, trunk().cableId, trunk().cableId]);
    expect(s()!.cables[2]!.vertices[0]!.elementId).toBe('ceo1');
    expect(openStack(s()!)).toEqual([trunk().cableId, r2]);
  });

  it('ramal dentro de ramal: voltar leva ao cabo imediatamente anterior', () => {
    atJunction();
    const r1 = cableDraftStore.branch(DROP)!;
    cableDraftStore.addVertex({ elementId: 'cto1', ...C }, 'cto1');
    const r2 = cableDraftStore.branch({ cableType: 'drop', fiberCount: 1 })!;
    expect(s()!.cables[2]!.parentId).toBe(r1);
    expect(openStack(s()!)).toEqual([trunk().cableId, r1, r2]);
    cableDraftStore.addVertex({ ...D });
    cableDraftStore.endBranch();
    expect(activeCable(s()!).cableId).toBe(r1);
    cableDraftStore.endBranch();
    expect(activeCable(s()!).cableId).toBe(trunk().cableId);
  });

  it('desfazer anda para trás por tudo: ponto, "terminei o ramal" e a própria derivação', () => {
    atJunction();
    const r1 = cableDraftStore.branch(DROP)!;
    cableDraftStore.addVertex({ elementId: 'cto1', ...C }, 'cto1');
    cableDraftStore.endBranch();
    cableDraftStore.addVertex({ elementId: 'p3', ...D }, 'p3');

    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex', createdElementId: 'p3' }); // sai do tronco
    expect(trunk().vertices).toHaveLength(2);
    expect(cableDraftStore.undo()).toEqual({ kind: 'return', cableId: r1 }); // volta para dentro do ramal
    expect(activeCable(s()!).cableId).toBe(r1);
    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex', createdElementId: 'cto1' }); // sai do ramal
    expect(s()!.cables[1]!.vertices).toHaveLength(1);
    expect(cableDraftStore.undo()).toEqual({ kind: 'branch', cableId: r1 }); // o ramal some
    expect(s()!.cables).toHaveLength(1);
    expect(activeCable(s()!).cableId).toBe(trunk().cableId);
    // e o tronco continua intacto até o ponto da CEO
    expect(trunk().vertices.map((v) => v.elementId)).toEqual(['p1', 'ceo1']);
    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex', createdElementId: 'ceo1' });
  });

  it('desfazer a reserva de um ramal tira só dele', () => {
    atJunction();
    const r1 = cableDraftStore.branch(DROP)!;
    cableDraftStore.addVertex({ ...C });
    cableDraftStore.addReserve('r1', 6);
    expect(draftReserveMeters(s()!)).toBe(6);
    expect(cableDraftStore.undo()).toMatchObject({ kind: 'reserve', cableId: r1, elementId: 'r1' });
    expect(draftReserveMeters(s()!)).toBe(0);
    expect(s()!.cables[1]!.vertices).toHaveLength(2);
  });

  it('a metragem soma todos os cabos; só os que têm 2+ pontos serão salvos', () => {
    atJunction();
    cableDraftStore.branch(DROP);
    expect(cablesToSave(s()!).map((c) => c.cableId)).toEqual([trunk().cableId]); // ramal só com a derivação não vira cabo
    cableDraftStore.addVertex({ ...C });
    cableDraftStore.addVertex({ ...D });
    expect(cablesToSave(s()!)).toHaveLength(2);
    const total = draftLengthMeters(s()!);
    expect(total).toBe(Math.round((cableLengthMeters(s()!.cables[0]!) + cableLengthMeters(s()!.cables[1]!)) * 100) / 100);
    expect(total).toBeGreaterThan(cableLengthMeters(trunk()));
  });

  it('um ramal pronto sozinho já permite finalizar (tronco com menos de 2 pontos fica de fora)', () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    cableDraftStore.addVertex({ elementId: 'ceo1', ...A }, 'ceo1');
    expect(canFinishDraft(s()!)).toBe(false);
    cableDraftStore.branch(DROP);
    cableDraftStore.addVertex({ ...B });
    expect(canFinishDraft(s()!)).toBe(true);
    expect(cablesToSave(s()!)).toHaveLength(1);
    expect(cablesToSave(s()!)[0]!.parentId).toBe(trunk().cableId);
  });
});

describe('pilha de cabos abertos (dados gravados fora de ordem não derrubam nada)', () => {
  const cab = (cableId: string, parentId?: string) => ({ cableId, cableType: 'drop', fiberCount: 2, vertices: [], ...(parentId ? { parentId } : {}) });
  const draft = (actions: unknown[]) => readDraft({ cables: [cab('t'), cab('r1', 't'), cab('r2', 't')], actions, startedAt: 1 })!;

  it('"voltei" do tronco não tira o tronco da pilha', () => {
    expect(openStack(draft([{ kind: 'return', cableId: 't' }]))).toEqual(['t']);
  });
  it('"voltei" de um ramal que não é o aberto agora é ignorado', () => {
    const d = draft([{ kind: 'branch', cableId: 'r1' }, { kind: 'return', cableId: 'r2' }]);
    expect(openStack(d)).toEqual(['t', 'r1']);
  });
  it('derivar, voltar e derivar de novo deixa só o último aberto', () => {
    const d = draft([{ kind: 'branch', cableId: 'r1' }, { kind: 'return', cableId: 'r1' }, { kind: 'branch', cableId: 'r2' }]);
    expect(openStack(d)).toEqual(['t', 'r2']);
  });
});

describe('pontos dentro de um ramal', () => {
  const DROP = { cableType: 'drop', fiberCount: 2 };
  function inRamal() {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    cableDraftStore.addVertex({ elementId: 'ceo1', ...B }, 'ceo1');
    cableDraftStore.branch(DROP);
  }
  it('o mesmo ponto em sequência é ignorado no ramal (compara com o último do ramal, não com o do tronco)', () => {
    inRamal();
    expect(cableDraftStore.addVertex({ elementId: 'p2', ...C }, 'p2')).toBe(true);
    expect(cableDraftStore.addVertex({ elementId: 'p2', ...C })).toBe(false);
    expect(cableDraftStore.addVertex({ ...C })).toBe(false);
    expect(s()!.cables[1]!.vertices).toHaveLength(2);
  });
  it('o ramal pode passar de novo pelo último ponto do tronco (o ramal que volta)', () => {
    inRamal();
    cableDraftStore.addVertex({ ...C });
    expect(cableDraftStore.addVertex({ elementId: 'ceo1', ...B })).toBe(true);
  });
});

describe('persistência (retomar depois de recarregar)', () => {
  it('grava a cada mudança e remove ao limpar', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    await settle();
    const saved = (await db.settings.get(SETTING_KEYS.cableDraft))?.value as { cables: { vertices: unknown[]; cableType: string }[] };
    expect(saved.cables[0]!.cableType).toBe('AS-80');
    expect(saved.cables[0]!.vertices).toHaveLength(1);
    cableDraftStore.clear();
    await settle();
    expect(await db.settings.get(SETTING_KEYS.cableDraft)).toBeUndefined();
  });

  it('hydrate retoma o que foi gravado (com a memória realmente vazia); ignora lixo', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    cableDraftStore.addVertex({ elementId: 'ceo1', ...B }, 'ceo1');
    cableDraftStore.branch({ cableType: 'drop', fiberCount: 2 });
    cableDraftStore.addVertex(C);
    cableDraftStore.addReserve('r1', 7);
    await settle();
    const gravado = (await db.settings.get(SETTING_KEYS.cableDraft))!.value;

    // Simula fechar e reabrir o app: a memória fica vazia, o que estava gravado permanece.
    cableDraftStore.clear();
    await settle();
    expect(s()).toBeNull();
    await db.settings.put({ key: SETTING_KEYS.cableDraft, value: gravado });

    expect(await cableDraftStore.hydrate()).toBe(true);
    expect(s()).toEqual(gravado);
    expect(s()!.cables).toHaveLength(2);
    expect(inBranch(s()!)).toBe(true); // retomou dentro do ramal
    expect(draftReserveMeters(s()!)).toBe(7);

    // dado corrompido não é retomado
    cableDraftStore.clear();
    await settle();
    await db.settings.put({ key: SETTING_KEYS.cableDraft, value: { lixo: true } });
    expect(await cableDraftStore.hydrate()).toBe(false);
    expect(s()).toBeNull();
  });
});

describe('lançamento gravado por uma versão sem ramais', () => {
  const legacy = {
    cableId: '11111111-1111-4111-8111-111111111111',
    cableType: 'AS-80',
    fiberCount: 12,
    colorStandard: 'abnt',
    vertices: [
      { elementId: 'p1', ...A },
      { ...B },
    ],
    actions: [{ kind: 'vertex', createdElementId: 'p1' }, { kind: 'vertex' }, { kind: 'reserve', elementId: 'r1', meters: 9 }],
    startedAt: 1234,
  };

  it('vira um tronco só, e as reservas passam a apontar para ele', () => {
    const d = readDraft(legacy)!;
    expect(d.cables).toEqual([
      { cableId: legacy.cableId, cableType: 'AS-80', fiberCount: 12, colorStandard: 'abnt', vertices: legacy.vertices },
    ]);
    expect(d.startedAt).toBe(1234);
    expect(d.actions[2]).toEqual({ kind: 'reserve', cableId: legacy.cableId, elementId: 'r1', meters: 9 });
    expect(cableReserveMeters(d, legacy.cableId)).toBe(9);
    expect(activeCable(d).cableId).toBe(legacy.cableId);
  });

  it('é retomado pelo hydrate', async () => {
    await db.settings.put({ key: SETTING_KEYS.cableDraft, value: legacy });
    expect(await cableDraftStore.hydrate()).toBe(true);
    expect(s()!.cables[0]!.cableId).toBe(legacy.cableId);
    expect(canFinishDraft(s()!)).toBe(true);
  });

  it('sem padrão de cores gravado, continua sem (vale ABNT)', () => {
    const { colorStandard: _drop, ...semPadrao } = legacy;
    expect('colorStandard' in readDraft(semPadrao)!.cables[0]!).toBe(false);
  });

  it('o que está incompleto ou fora de forma não é retomado', () => {
    expect(readDraft(null)).toBeNull();
    expect(readDraft('texto')).toBeNull();
    expect(readDraft({ ...legacy, actions: undefined })).toBeNull();
    expect(readDraft({ ...legacy, vertices: undefined })).toBeNull();
    expect(readDraft({ ...legacy, cableType: 3 })).toBeNull();
    expect(readDraft({ ...legacy, cableId: 7 })).toBeNull();
    expect(readDraft({ ...legacy, fiberCount: '12' })).toBeNull();
    expect(readDraft({ cables: [], actions: [], startedAt: 1 })).toBeNull();
    expect(readDraft({ cables: [{ cableId: 'x' }], actions: [], startedAt: 1 })).toBeNull();
    expect(readDraft({ cables: [{ ...legacy }, null], actions: [], startedAt: 1 })).toBeNull();
  });
});
