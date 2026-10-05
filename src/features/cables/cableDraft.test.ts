import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTING_KEYS, db } from '../../db/db';
import { cableDraftStore, canFinishDraft, draftLengthMeters, draftReserveMeters } from './cableDraft';

const s = () => cableDraftStore.getState();
const settle = () => new Promise((r) => setTimeout(r, 20)); // deixa a gravação assíncrona terminar

beforeEach(async () => {
  cableDraftStore.clear();
  await settle();
});

const A = { lat: -23.55, lng: -46.63 };
const B = { lat: -23.5503, lng: -46.6301 };
const C = { lat: -23.5506, lng: -46.6303 };

describe('rascunho do cabo', () => {
  it('começa vazio, com id próprio e as escolhas feitas', () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    expect(s()).toMatchObject({ cableType: 'AS-80', fiberCount: 12, vertices: [], actions: [] });
    expect(s()!.cableId).toMatch(/^[0-9a-f-]{36}$/);
    expect(canFinishDraft(s()!)).toBe(false);
  });

  it('pontos entram na ordem; só pode finalizar com 2 ou mais', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    expect(canFinishDraft(s()!)).toBe(false);
    cableDraftStore.addVertex({ ...B });
    expect(canFinishDraft(s()!)).toBe(true);
    expect(s()!.vertices.map((v) => v.elementId)).toEqual(['p1', undefined]);
  });

  it('ignora o mesmo ponto em sequência (mesmo elemento ou mesma posição)', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    expect(cableDraftStore.addVertex({ elementId: 'p1', ...A })).toBe(true);
    expect(cableDraftStore.addVertex({ elementId: 'p1', lat: 9, lng: 9 })).toBe(false); // mesmo elemento
    expect(cableDraftStore.addVertex({ ...A })).toBe(false); // mesma posição
    expect(s()!.vertices).toHaveLength(1);
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
    expect(draftLengthMeters(s()!)).toBeGreaterThan(30);
  });

  it('desfazer volta uma ação por vez, na ordem inversa, e diz o que foi desfeito', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    cableDraftStore.addVertex({ elementId: 'p2', ...B }, 'p2');
    cableDraftStore.addReserve('r1', 10);

    expect(cableDraftStore.undo()).toEqual({ kind: 'reserve', elementId: 'r1', meters: 10 });
    expect(s()!.vertices).toHaveLength(2); // desfazer a reserva não mexe nos pontos
    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex', createdElementId: 'p2' });
    expect(s()!.vertices).toHaveLength(1);
    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex', createdElementId: 'p1' });
    expect(cableDraftStore.undo()).toBeNull();
    expect(s()!.vertices).toEqual([]);
  });

  it('ponto que não criou elemento (toque num existente ou solto) é desfeito sem apagar nada', () => {
    cableDraftStore.begin({ cableType: 'drop', fiberCount: 1 });
    cableDraftStore.addVertex({ elementId: 'velho', ...A }); // elemento que já existia
    expect(cableDraftStore.undo()).toEqual({ kind: 'vertex' });
  });

  it('sem rascunho, as operações não fazem nada', () => {
    expect(cableDraftStore.addVertex(A)).toBe(false);
    expect(cableDraftStore.undo()).toBeNull();
  });
});

describe('persistência (retomar depois de recarregar)', () => {
  it('grava a cada mudança e remove ao limpar', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    await settle();
    const saved = (await db.settings.get(SETTING_KEYS.cableDraft))?.value as { vertices: unknown[]; cableType: string };
    expect(saved.cableType).toBe('AS-80');
    expect(saved.vertices).toHaveLength(1);
    cableDraftStore.clear();
    await settle();
    expect(await db.settings.get(SETTING_KEYS.cableDraft)).toBeUndefined();
  });

  it('hydrate retoma o que foi gravado (com a memória realmente vazia); ignora lixo', async () => {
    cableDraftStore.begin({ cableType: 'AS-80', fiberCount: 12 });
    cableDraftStore.addVertex({ elementId: 'p1', ...A }, 'p1');
    cableDraftStore.addVertex(B);
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
    expect(s()!.vertices).toHaveLength(2);
    expect(draftReserveMeters(s()!)).toBe(7);

    // dado corrompido não é retomado
    cableDraftStore.clear();
    await settle();
    await db.settings.put({ key: SETTING_KEYS.cableDraft, value: { lixo: true } });
    expect(await cableDraftStore.hydrate()).toBe(false);
    expect(s()).toBeNull();
  });
});
