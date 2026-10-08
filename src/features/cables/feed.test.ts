import { describe, expect, it } from 'vitest';
import type { Cable, NetworkElement } from '../../db/types';
import { FEED_NEAR_METERS, ctoName, describeFeed, feedChoices, feedText, readFeed, usedFibers } from './feed';

const C = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`;
const E = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const cable = (n: number, vertices: { elementId?: string; lat: number; lng: number }[], over: Partial<Cable> = {}): Cable => ({
  id: C(n), createdAt: 1, updatedAt: 1, createdBy: 'x', deleted: false, syncStatus: 'synced', cableType: 'AS-80', fiberCount: 12, vertices, lengthMeters: 0, reserveMeters: 0, totalMeters: 100, activityId: 'a', notes: '', ...over,
});
const cto = (n: number, code: string, attrs: Record<string, unknown>, deleted = false): NetworkElement => ({
  id: E(n), createdAt: 1, updatedAt: 1, createdBy: 'x', deleted, syncStatus: 'synced', type: 'cto', lat: 0, lng: 0, positionSource: 'gps', code, notes: '', activityId: 'a', attrs: attrs as NetworkElement['attrs'],
});

describe('readFeed', () => {
  it('cabo e fibra válidos', () => {
    expect(readFeed({ feedCableId: C(1), feedFiber: 7 })).toEqual({ cableId: C(1), fiber: 7 });
  });
  it('pela metade, inválido ou sem nada = null', () => {
    for (const bad of [null, undefined, 'x', 5, {}, { feedCableId: C(1) }, { feedFiber: 7 }, { feedCableId: 'nao-uuid', feedFiber: 7 }, { feedCableId: C(1), feedFiber: 0 }, { feedCableId: C(1), feedFiber: -2 }, { feedCableId: C(1), feedFiber: 1.5 }, { feedCableId: C(1), feedFiber: '7' }]) {
      expect(readFeed(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('feedChoices', () => {
  const here = { lat: -23.55, lng: -46.63 };
  const through = cable(1, [{ elementId: E(1), lat: -23.55018, lng: -46.63 }, { lat: -23.56, lng: -46.64 }]); // passa pela CTO (a ~20 m: mais longe que os outros dois, mas é ela)
  const near = cable(2, [{ lat: -23.55005, lng: -46.63 }, { lat: -23.56, lng: -46.65 }]); // ~5 m
  const nearer = cable(3, [{ lat: -23.550018, lng: -46.63 }, { lat: -23.56, lng: -46.65 }]); // ~2 m
  const far = cable(4, [{ lat: -23.56, lng: -46.65 }, { lat: -23.57, lng: -46.66 }]);
  it('primeiro os que passam pela CTO, depois os que estão perto, do mais perto ao mais longe; longe não entra', () => {
    const out = feedChoices(here, [far, near, through, nearer], E(1));
    expect(out.map((c) => c.cable.id)).toEqual([C(1), C(3), C(2)]);
    expect(out.map((c) => c.through)).toEqual([true, false, false]);
  });
  it('CTO ainda sem id (sendo criada): só os que estão perto, nenhum conta como "passa por ela"', () => {
    expect(feedChoices(here, [through, near, far]).map((c) => [c.cable.id, c.through])).toEqual([[C(2), false], [C(1), false]]); // sem id, nenhum "passa por ela"
  });
  it('o limite de distância é FEED_NEAR_METERS', () => {
    expect(FEED_NEAR_METERS).toBe(30);
    const edge = (m: number) => cable(5, [{ lat: -23.55 - m / 111_195, lng: -46.63 }, { lat: -23.57, lng: -46.66 }]);
    expect(feedChoices(here, [edge(29)])).toHaveLength(1);
    expect(feedChoices(here, [edge(32)])).toHaveLength(0);
  });
  it('cabo que passa pela CTO mas está longe do ponto dela (CTO marcada fora do lugar) também entra, primeiro', () => {
    const awayEl = cable(7, [{ elementId: E(1), lat: -23.56, lng: -46.65 }, { lat: -23.57, lng: -46.66 }]);
    expect(feedChoices(here, [near, awayEl], E(1)).map((c) => [c.cable.id, c.through])).toEqual([[C(7), true], [C(2), false]]);
  });
  it('cabo excluído não entra nem quando passa pela CTO', () => {
    const gone = cable(8, [{ elementId: E(1), lat: -23.55, lng: -46.63 }, { lat: -23.5501, lng: -46.63 }], { deleted: true });
    expect(feedChoices(here, [gone], E(1))).toEqual([]);
  });
  it('cabo já escolhido continua na lista mesmo longe; cabo excluído não entra', () => {
    expect(feedChoices(here, [far], undefined, C(4))).toHaveLength(1);
    expect(feedChoices(here, [far], undefined, C(4))[0]!.distance).toBe(Infinity);
    expect(feedChoices(here, [cable(6, [{ lat: -23.55, lng: -46.63 }, { lat: -23.5501, lng: -46.63 }], { deleted: true })])).toEqual([]);
  });
  it('o rótulo traz tipo, fibras e metros', () => {
    expect(feedChoices(here, [near])[0]!.label).toBe('AS-80 · 12 fibras · 100,0 m');
  });
});

describe('usedFibers', () => {
  const els = [cto(1, 'CTO-1', { feedCableId: C(1), feedFiber: 3 }), cto(2, 'CTO-2', { feedCableId: C(1), feedFiber: 5 }), cto(3, '', { feedCableId: C(1), feedFiber: 5 }), cto(4, 'CTO-4', { feedCableId: C(2), feedFiber: 3 }), cto(5, 'CTO-5', { feedCableId: C(1), feedFiber: 9 }, true), cto(6, 'CTO-6', {})];
  it('fibra → quem usa, só deste cabo e sem excluídos', () => {
    expect(usedFibers(els, C(1))).toEqual(new Map([[3, 'CTO CTO-1'], [5, 'CTO CTO-2, CTO sem código']]));
    expect(usedFibers(els, C(2))).toEqual(new Map([[3, 'CTO CTO-4']]));
    expect(usedFibers(els, C(9))).toEqual(new Map());
  });
  it('a CTO que está sendo editada não conta contra si mesma', () => {
    expect(usedFibers(els, C(1), E(1)).has(3)).toBe(false);
    expect(usedFibers(els, C(1), E(1)).has(5)).toBe(true);
  });
  it('só CTO conta', () => {
    const poste = { ...cto(7, 'P', { feedCableId: C(1), feedFiber: 1 }), type: 'poste' as const };
    expect(usedFibers([poste], C(1)).size).toBe(0);
  });
  it('nome da CTO', () => {
    expect(ctoName({ code: 'CTO-9' })).toBe('CTO CTO-9');
    expect(ctoName({ code: '' })).toBe('CTO sem código');
  });
});

describe('describeFeed', () => {
  it('cor e tubo no padrão do cabo', () => {
    const c = cable(1, [], { fiberCount: 48 });
    expect(describeFeed({ cableId: C(1), fiber: 19 }, [c])).toMatchObject({ text: 'Fibra 19 · Marrom · Tubo 2 Amarelo', cable: c });
    expect(describeFeed({ cableId: C(1), fiber: 1 }, [{ ...c, colorStandard: 'tia598' }]).text).toBe('Fibra 1 · Azul · Tubo 1 Azul');
  });
  it('cabo que não existe, excluído ou sem essa fibra: diz o motivo', () => {
    const c = cable(1, [], { fiberCount: 6 });
    expect(describeFeed({ cableId: C(2), fiber: 3 }, [c])).toEqual({ cable: null, fiber: null, text: 'Fibra 3 (cabo não encontrado)' });
    expect(describeFeed({ cableId: C(1), fiber: 3 }, [{ ...c, deleted: true }]).cable).toBeNull();
    expect(describeFeed({ cableId: C(1), fiber: 9 }, [c])).toMatchObject({ fiber: null, text: 'Fibra 9 (este cabo só tem 6 fibras)' });
  });
});

describe('feedText', () => {
  it('numa linha: fibra, cor, tubo e o cabo', () => {
    const c = cable(1, [], { fiberCount: 48 });
    expect(feedText({ feedCableId: C(1), feedFiber: 19 }, [c])).toBe('Fibra 19 · Marrom · Tubo 2 Amarelo (AS-80 · 48 fibras)');
  });
  it('sem fibra de entrada = null; cabo que sumiu = só o texto do motivo', () => {
    expect(feedText({}, [])).toBeNull();
    expect(feedText({ feedCableId: C(1), feedFiber: 3 }, [])).toBe('Fibra 3 (cabo não encontrado)');
  });
});
