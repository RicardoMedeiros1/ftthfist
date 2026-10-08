import { describe, expect, it } from 'vitest';
import type { Cable, CableLink, NetworkElement } from '../../db/types';
import { summarizeRoute } from './routeSummary';

const E = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const C = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`;
const cable = (n: number, els: number[], links: CableLink[] = [], over: Partial<Cable> = {}): Cable => ({
  id: C(n), createdAt: 1, updatedAt: 1, createdBy: 'x', deleted: false, syncStatus: 'synced', cableType: 'AS-80', fiberCount: 12,
  vertices: els.map((e, i) => ({ elementId: E(e), lat: i, lng: i })), lengthMeters: 0, reserveMeters: 0, totalMeters: 100, activityId: 'a', notes: '', links, ...over,
});
const el = (n: number, type: NetworkElement['type'], code: string, attrs: Record<string, unknown> = {}, deleted = false): NetworkElement => ({
  id: E(n), createdAt: 1, updatedAt: 1, createdBy: 'x', deleted, syncStatus: 'synced', type, lat: 0, lng: 0, positionSource: 'gps', code, notes: '', activityId: 'a', attrs: attrs as NetworkElement['attrs'],
});

// tronco 1 (elementos 1,2,3) com derivação 2 saindo do 2 até a CTO 4; derivação 3 saindo do 3 até a CTO 5; cabo solto 9 com a CTO 8
const net = () => [cable(1, [1, 2, 3], [], { totalMeters: 80 }), cable(2, [2, 4], [{ elementId: E(2), cableId: C(1) }], { totalMeters: 60 }), cable(3, [3, 5, 6], [{ elementId: E(3), cableId: C(1) }], { totalMeters: 40, fiberCount: 48 }), cable(9, [7, 8])];

describe('summarizeRoute', () => {
  const elements = () => [
    el(4, 'cto', 'CTO-2', { feedCableId: C(2), feedFiber: 7 }),
    el(5, 'cto', 'CTO-10', { feedCableId: C(3), feedFiber: 19 }),
    el(6, 'cto', 'CTO-3'), // na ponta da derivação 3, sem fibra informada
    el(8, 'cto', 'CTO-9', { feedCableId: C(9), feedFiber: 1 }),
    el(2, 'ceo', 'CEO-1'),
  ];
  it('os cabos da rota (o de partida primeiro), os metros e as CTOs com a fibra de cada uma', () => {
    const s = summarizeRoute(C(2), net(), elements());
    expect(s.cables.map((c) => c.id)).toEqual([C(2), C(1), C(3)]);
    expect(s.meters).toBe(180);
    expect(s.ctos.map((c) => c.element.code)).toEqual(['CTO-2', 'CTO-3', 'CTO-10']); // ordem numérica, não alfabética
    expect(s.ctos.map((c) => c.feed?.text ?? null)).toEqual(['Fibra 7 · Marrom', null, 'Fibra 19 · Marrom · Tubo 2 Amarelo']);
  });
  it('de qualquer cabo da rede dá a mesma rede', () => {
    for (const n of [1, 2, 3]) expect(new Set(summarizeRoute(C(n), net(), elements()).cables.map((c) => c.id))).toEqual(new Set([C(1), C(2), C(3)]));
  });
  it('não inclui CTO de outra rota nem elemento que não é CTO', () => {
    const s = summarizeRoute(C(1), net(), elements());
    expect(s.ctos.map((c) => c.element.code)).not.toContain('CTO-9');
    expect(s.ctos.every((c) => c.element.type === 'cto')).toBe(true);
  });
  it('CTO que só tem a fibra apontando para um cabo da rota (sem estar no traçado) também entra', () => {
    const lone = el(20, 'cto', 'CTO-X', { feedCableId: C(3), feedFiber: 2 });
    expect(summarizeRoute(C(1), net(), [lone]).ctos.map((c) => c.element.id)).toEqual([E(20)]);
  });
  it('CTO excluída não entra', () => {
    expect(summarizeRoute(C(1), net(), [el(4, 'cto', 'CTO-2', {}, true)]).ctos).toEqual([]);
  });
  it('CTO sem código vai por último', () => {
    const s = summarizeRoute(C(2), net(), [el(4, 'cto', ''), el(5, 'cto', 'CTO-1', { feedCableId: C(3), feedFiber: 1 })]);
    expect(s.ctos.map((c) => c.element.code)).toEqual(['CTO-1', '']);
  });
  it('quantas fibras de cada cabo já alimentam CTO', () => {
    const s = summarizeRoute(C(1), net(), elements());
    expect(s.fibersInUse.get(C(2))).toBe(1);
    expect(s.fibersInUse.get(C(3))).toBe(1);
    expect(s.fibersInUse.get(C(1))).toBe(0);
    expect(s.fibersInUse.size).toBe(3);
  });
  it('cabo sem ligação: a rota é só ele', () => {
    const s = summarizeRoute(C(9), net(), elements());
    expect(s.cables.map((c) => c.id)).toEqual([C(9)]);
    expect(s.ctos.map((c) => c.element.code)).toEqual(['CTO-9']);
    expect(s.meters).toBe(100);
  });
  it('cabo que não existe: tudo vazio', () => {
    const s = summarizeRoute(C(99), net(), elements());
    expect(s.cables).toEqual([]);
    expect(s.ctos).toEqual([]);
    expect(s.meters).toBe(0);
  });
  it('a fibra aparece com o cabo e o padrão certos', () => {
    const cs = net();
    cs[2] = { ...cs[2]!, colorStandard: 'tia598' };
    expect(summarizeRoute(C(1), cs, elements()).ctos.find((c) => c.element.code === 'CTO-10')!.feed!.text).toBe('Fibra 19 · Vermelho · Tubo 2 Laranja');
  });
});
