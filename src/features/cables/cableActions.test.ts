import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTING_KEYS, db, getSetting } from '../../db/db';
import type { Cable, NetworkElement } from '../../db/types';
import { setActingUser } from '../../lib/ownership';
import { activities } from '../activities/activityRepo';
import { draftStore } from '../elements/draftStore';
import { elementStore } from '../elements/elementRepo';
import { branchHere, discardCable, endBranchHere, finishCable, summaryOf, undoLast } from './cableActions';
import { cableDraftStore, type DraftVertex } from './cableDraft';
import { routeOf } from './routes';

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  cableDraftStore.clear();
  draftStore.cancel();
  await settle();
  await Promise.all(db.tables.map((t) => t.clear()));
  await activities.create({ kind: 'implantacao', title: 'Rua A' }, 'Carlos');
});

let n = 0;
/** Marca um elemento no banco e o devolve como ponto do traçado (ficam ~11 m um do outro). */
async function mark(type: NetworkElement['type'], attrs?: unknown): Promise<DraftVertex & { elementId: string }> {
  n += 1;
  const el = await elementStore.create({ type, lat: -23.55 - n * 0.0001, lng: -46.63, positionSource: 'manual', attrs }, 'Carlos');
  return { elementId: el.id, lat: el.lat, lng: el.lng };
}
const lay = (v: DraftVertex & { elementId: string }) => cableDraftStore.addVertex(v, v.elementId);
const saved = async () => (await db.cables.toArray()) as Cable[];
const byType = (cables: Cable[], t: string) => cables.filter((c) => c.cableType === t);

/** A rede do desenho: tronco p1 → ceo1 → p2 → ceo2 → p3, com um ramal de cada CEO até uma CTO (cto1, cto2). */
async function network() {
  cableDraftStore.begin({ cableType: 'AS-120', fiberCount: 48 });
  const trunkId = cableDraftStore.getState()!.cables[0]!.cableId;
  lay(await mark('poste'));
  const ceo1 = await mark('ceo');
  lay(ceo1);
  await branchHere({ cableType: 'AS-80', fiberCount: 12 });
  const b1 = cableDraftStore.getState()!.cables[1]!.cableId;
  lay(await mark('poste'));
  const cto1 = await mark('cto', { capacity: 8 });
  lay(cto1);
  endBranchHere();
  lay(await mark('poste'));
  const ceo2 = await mark('ceo');
  lay(ceo2);
  await branchHere({ cableType: 'drop', fiberCount: 2 });
  const b2 = cableDraftStore.getState()!.cables[2]!.cableId;
  const cto2 = await mark('cto');
  lay(cto2);
  endBranchHere();
  lay(await mark('poste'));
  return { trunkId, b1, b2, ceo1, ceo2, cto1, cto2 };
}

describe('finalizar o lançamento em árvore', () => {
  it('salva o tronco e os ramais de uma vez, cada ramal ligado ao tronco na CEO onde derivou', async () => {
    const { trunkId, b1, b2, ceo1, ceo2 } = await network();
    expect(summaryOf(cableDraftStore.getState()!).items).toHaveLength(3);

    const msg = await finishCable('rua dos Caramujos');
    expect(msg).toMatch(/^3 cabos salvos: /);

    const cables = await saved();
    expect(cables.map((c) => c.id).sort()).toEqual([trunkId, b1, b2].sort());
    const get = (id: string) => cables.find((c) => c.id === id)!;
    expect(get(trunkId).notes).toBe('rua dos Caramujos');
    expect(get(b1).notes).toBe('');
    expect(get(b1).links).toEqual([{ elementId: ceo1.elementId, cableId: trunkId }]);
    expect(get(b2).links).toEqual([{ elementId: ceo2.elementId, cableId: trunkId }]);
    expect(get(trunkId).links).toBeUndefined();
    // clicar em qualquer parte acende a rede inteira
    expect(routeOf(b2, cables).cableIds.sort()).toEqual([trunkId, b1, b2].sort());
    expect(get(trunkId).vertices).toHaveLength(5);
    expect(get(b1).vertices).toHaveLength(3);
    expect(get(b2).vertices).toHaveLength(2);

    expect(cableDraftStore.getState()).toBeNull();
    await settle();
    expect(await db.settings.get(SETTING_KEYS.cableDraft)).toBeUndefined();
    expect(draftStore.getState().notice).toBe(msg);
  });

  it('lembra o cabo do tronco para o próximo lançamento e o do ramal para a próxima derivação', async () => {
    await network();
    expect(await getSetting(SETTING_KEYS.lastBranch, null)).toEqual({ cableType: 'drop', fiberCount: 2 }); // o último ramal escolhido
    await finishCable('');
    expect(await getSetting(SETTING_KEYS.lastCable, null)).toEqual({ cableType: 'AS-120', fiberCount: 48 });
  });

  it('um cabo só continua sendo "Cabo salvo"', async () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    lay(await mark('poste'));
    lay(await mark('poste'));
    expect(await finishCable('x')).toMatch(/^Cabo salvo: /);
    expect(await saved()).toHaveLength(1);
  });

  it('grava a fibra de cada CTO no cabo onde ela termina, sem perder o que a CTO já tinha', async () => {
    const { b1, b2, cto1, cto2 } = await network();
    await finishCable('', [
      { elementId: cto1.elementId, cableId: b1, fiber: 3 },
      { elementId: cto2.elementId, cableId: b2, fiber: 2 },
    ]);
    const a1 = (await db.elements.get(cto1.elementId))!;
    const a2 = (await db.elements.get(cto2.elementId))!;
    expect(a1.attrs).toEqual({ capacity: 8, feedCableId: b1, feedFiber: 3 });
    expect(a2.attrs).toEqual({ feedCableId: b2, feedFiber: 2 });
    expect(a1.syncStatus).toBe('pending');
  });

  it('grava o código da CTO (com ou sem fibra) e ignora código vazio', async () => {
    const { b1, cto1, cto2 } = await network();
    await finishCable('', [
      { elementId: cto1.elementId, code: '  CTO-12  ', cableId: b1, fiber: 1 },
      { elementId: cto2.elementId, code: '   ' },
    ]);
    const a1 = (await db.elements.get(cto1.elementId))!;
    const a2 = (await db.elements.get(cto2.elementId))!;
    expect([a1.code, a1.attrs]).toEqual(['CTO-12', { capacity: 8, feedCableId: b1, feedFiber: 1 }]);
    expect([a2.code, a2.attrs]).toEqual(['', {}]);
  });

  it('fibra que não vale é ignorada: acima do cabo, zero, cabo de fora, elemento que não é CTO, elemento inexistente', async () => {
    const { trunkId, b1, ceo1, cto1, cto2 } = await network();
    await finishCable('', [
      { elementId: cto1.elementId, cableId: b1, fiber: 13 }, // o ramal tem 12
      { elementId: cto2.elementId, cableId: crypto.randomUUID(), fiber: 1 },
      { elementId: ceo1.elementId, cableId: trunkId, fiber: 1 }, // CEO não tem fibra de entrada
      { elementId: crypto.randomUUID(), cableId: b1, fiber: 1 },
      { elementId: cto2.elementId, cableId: b1, fiber: 0 },
    ]);
    expect((await db.elements.get(cto1.elementId))!.attrs).toEqual({ capacity: 8 });
    expect((await db.elements.get(cto2.elementId))!.attrs).toEqual({});
    expect((await db.elements.get(ceo1.elementId))!.attrs).toEqual({});
  });

  it('CTO de outro técnico não é alterada, mas o resto é salvo', async () => {
    const { b1, cto1 } = await network();
    await db.elements.update(cto1.elementId, { ownerId: 'outra-pessoa' });
    setActingUser('carlos-id');
    try {
      await finishCable('', [{ elementId: cto1.elementId, cableId: b1, fiber: 1 }]);
    } finally {
      setActingUser(null);
    }
    expect(await saved()).toHaveLength(3);
    expect((await db.elements.get(cto1.elementId))!.attrs).toEqual({ capacity: 8 });
  });

  it('ramal que só tem a derivação não vira cabo; ramal cujo tronco não vira cabo fica sem ligação', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    const trunkId = cableDraftStore.getState()!.cables[0]!.cableId;
    const ceo = await mark('ceo');
    lay(ceo); // tronco com 1 ponto só
    await branchHere({ cableType: 'drop', fiberCount: 2 });
    const solo = cableDraftStore.getState()!.cables[1]!.cableId;
    lay(await mark('cto'));
    endBranchHere();
    await branchHere({ cableType: 'drop', fiberCount: 1 }); // outro ramal que não anda
    await finishCable('');
    const cables = await saved();
    expect(cables.map((c) => c.id)).toEqual([solo]);
    expect(cables[0]!.links).toBeUndefined();
    expect(cables.some((c) => c.id === trunkId)).toBe(false);
  });

  it('tudo ou nada: sem atividade aberta nada é salvo e o lançamento continua para tentar de novo', async () => {
    const { b1, cto1 } = await network();
    await db.activities.clear();
    await expect(finishCable('', [{ elementId: cto1.elementId, cableId: b1, fiber: 1 }])).rejects.toThrow(/atividade/i);
    expect(await saved()).toEqual([]);
    expect((await db.elements.get(cto1.elementId))!.attrs).toEqual({ capacity: 8 });
    expect(cableDraftStore.getState()!.cables).toHaveLength(3);
  });

  it('sem lançamento, não há o que finalizar', async () => {
    await expect(finishCable('')).rejects.toThrow();
  });
});

describe('derivar e terminar ramais', () => {
  it('não deriva de um ponto solto e diz o que fazer', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    cableDraftStore.addVertex({ lat: -23.5, lng: -46.6 });
    const r = await branchHere({ cableType: 'drop', fiberCount: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/poste, CEO ou CTO/);
    expect(await getSetting(SETTING_KEYS.lastBranch, null)).toBeNull(); // nada foi lembrado
  });

  it('terminar o ramal sem nenhum ponto novo é recusado', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    lay(await mark('ceo'));
    expect(endBranchHere().ok).toBe(false); // no tronco
    await branchHere({ cableType: 'drop', fiberCount: 2 });
    const r = endBranchHere(); // ramal sem ponto
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/ao menos um ponto/);
  });

  it('desfazer a CTO criada no ramal a tira do mapa; desfazer a derivação não apaga nada', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    lay(await mark('poste'));
    const ceo = await mark('ceo');
    lay(ceo);
    await branchHere({ cableType: 'drop', fiberCount: 2 });
    const cto = await mark('cto');
    lay(cto);
    await undoLast(); // a CTO
    expect((await db.elements.get(cto.elementId))!.deleted).toBe(true);
    await undoLast(); // a derivação
    expect(cableDraftStore.getState()!.cables).toHaveLength(1);
    expect((await db.elements.get(ceo.elementId))!.deleted).toBe(false);
  });
});

describe('descartar', () => {
  it('solta as reservas de todos os cabos do lançamento e limpa o rascunho', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    const trunkId = cableDraftStore.getState()!.cables[0]!.cableId;
    lay(await mark('poste'));
    lay(await mark('ceo'));
    const r1 = await mark('reserva', { meters: 5, cableId: trunkId });
    await branchHere({ cableType: 'drop', fiberCount: 2 });
    const branchId = cableDraftStore.getState()!.cables[1]!.cableId;
    const r2 = await mark('reserva', { meters: 7, cableId: branchId });
    await discardCable();
    expect((await db.elements.get(r1.elementId))!.attrs).toEqual({ meters: 5 });
    expect((await db.elements.get(r2.elementId))!.attrs).toEqual({ meters: 7 });
    expect(cableDraftStore.getState()).toBeNull();
    expect(await saved()).toEqual([]);
  });
});

describe('resumo', () => {
  it('lista só o que será salvo, com metragem e reservas de cada cabo e a soma', async () => {
    const { trunkId, b1 } = await network();
    const a = summaryOf(cableDraftStore.getState()!);
    expect(a.items.map((i) => i.cable.cableId)).toEqual([trunkId, b1, a.items[2]!.cable.cableId]);
    expect(a.items.every((i) => i.length > 0 && i.reserves === 0 && i.total === i.length)).toBe(true);
    expect(a.length).toBe(Math.round(a.items.reduce((s, i) => s + i.length, 0) * 100) / 100);
    expect(a.total).toBe(a.length);
    expect(byType(await saved(), 'drop')).toEqual([]); // nada foi salvo ainda
  });
});
