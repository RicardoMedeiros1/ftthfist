import { describe, expect, it } from 'vitest';
import type { Cable, CableLink } from '../../db/types';
import { activeEdges, cablesAt, connectionsOf, linkedAt, planLinks, routeMeters, routeOf } from './routes';

const E = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
const cable = (id: string, elementIds: string[], links: CableLink[] = [], deleted = false): Cable => ({
  id, createdAt: 1, updatedAt: 1, createdBy: 'x', deleted, syncStatus: 'pending', cableType: 'AS-80', fiberCount: 12,
  vertices: elementIds.map((e, i) => ({ elementId: e, lat: i, lng: i })), lengthMeters: 0, reserveMeters: 0, totalMeters: 0, activityId: 'a', notes: '', links,
});
const L = (elementId: string, cableId: string): CableLink => ({ elementId, cableId });

// Tronco T passa pelos elementos 1, 2, 3; derivações D1 (sai do 2) e D2 (sai do 3); D3 sai do fim de D1 (elemento 5).
const T = () => cable('T', [E(1), E(2), E(3)]);
const D1 = () => cable('D1', [E(2), E(4), E(5)], [L(E(2), 'T')]);
const D2 = () => cable('D2', [E(3), E(6)], [L(E(3), 'T')]);
const D3 = () => cable('D3', [E(5), E(7)], [L(E(5), 'D1')]);
const solo = () => cable('S', [E(8), E(9)]);
const net = () => [T(), D1(), D2(), D3(), solo()];

describe('activeEdges', () => {
  it('uma ligação por par e elemento, nos dois cabos', () => {
    const edges = activeEdges(net());
    expect(edges).toHaveLength(3);
    expect(edges.map((e) => [e.elementId, [e.a, e.b].sort().join('-')])).toEqual([[E(2), 'D1-T'], [E(3), 'D2-T'], [E(5), 'D1-D3']]);
  });
  it('ligação guardada nos dois cabos conta uma vez', () => {
    const t = cable('T', [E(1), E(2)], [L(E(2), 'D1')]);
    expect(activeEdges([t, D1()])).toHaveLength(1);
  });
  it('some se um dos cabos foi excluído, e volta se ele voltar', () => {
    expect(activeEdges([T(), cable('D1', [E(2), E(4)], [L(E(2), 'T')], true)])).toEqual([]);
    expect(activeEdges([cable('T', [E(1), E(2)], [], true), D1()])).toEqual([]);
  });
  it('some se um dos cabos deixou de passar pelo elemento', () => {
    expect(activeEdges([cable('T', [E(1), E(3)]), D1()])).toEqual([]);
    expect(activeEdges([T(), cable('D1', [E(4), E(5)], [L(E(2), 'T')])])).toEqual([]);
  });
  it('ligação para cabo que não existe, para si mesmo ou lixo não vale', () => {
    expect(activeEdges([cable('T', [E(1), E(2)], [L(E(2), 'ninguem')])])).toEqual([]);
    expect(activeEdges([cable('T', [E(1), E(2)], [L(E(2), 'T')])])).toEqual([]);
    expect(activeEdges([])).toEqual([]);
  });
  it('o mesmo par ligado em elementos diferentes são ligações diferentes', () => {
    const a = cable('A', [E(1), E(2)], [L(E(1), 'B'), L(E(2), 'B')]);
    const b = cable('B', [E(1), E(2)]);
    expect(activeEdges([a, b]).map((e) => e.elementId)).toEqual([E(1), E(2)]);
  });
});

describe('cablesAt / linkedAt', () => {
  it('cabos que passam pelo elemento, sem os excluídos', () => {
    expect(cablesAt(net(), E(2)).map((c) => c.id)).toEqual(['T', 'D1']);
    expect(cablesAt([T(), cable('D1', [E(2), E(4)], [], true)], E(2)).map((c) => c.id)).toEqual(['T']);
    expect(cablesAt(net(), E(99))).toEqual([]);
  });
  it('quais deles já estão ligados naquele elemento', () => {
    expect([...linkedAt(net(), E(2))].sort()).toEqual(['D1', 'T']);
    expect([...linkedAt(net(), E(3))].sort()).toEqual(['D2', 'T']);
    expect([...linkedAt(net(), E(1))]).toEqual([]);
    expect([...linkedAt(net(), E(5))].sort()).toEqual(['D1', 'D3']);
  });
});

describe('routeOf', () => {
  it('de qualquer cabo da rede, a rede toda; o cabo de partida vem primeiro', () => {
    for (const start of ['T', 'D1', 'D2', 'D3']) {
      const r = routeOf(start, net());
      expect(r.cableIds[0]).toBe(start);
      expect([...r.cableIds].sort()).toEqual(['D1', 'D2', 'D3', 'T']);
      expect([...r.junctions].sort()).toEqual([E(2), E(3), E(5)].sort());
    }
  });
  it('cabo sem ligação: a rota é só ele', () => {
    expect(routeOf('S', net())).toEqual({ cableIds: ['S'], junctions: [] });
  });
  it('cabo que não existe ou foi excluído: rota vazia', () => {
    expect(routeOf('x', net())).toEqual({ cableIds: [], junctions: [] });
    expect(routeOf('S', [cable('S', [E(8), E(9)], [], true)])).toEqual({ cableIds: [], junctions: [] });
  });
  it('excluir um cabo no meio parte a rede em duas', () => {
    const cut = [T(), cable('D1', [E(2), E(4), E(5)], [L(E(2), 'T')], true), D2(), D3()];
    expect([...routeOf('T', cut).cableIds].sort()).toEqual(['D2', 'T']);
    expect(routeOf('D3', cut).cableIds).toEqual(['D3']);
  });
  it('anel de cabos não trava e não repete', () => {
    const a = cable('A', [E(1), E(2)], [L(E(1), 'B')]);
    const b = cable('B', [E(1), E(3)], [L(E(3), 'C')]);
    const c = cable('C', [E(3), E(2)], [L(E(2), 'A')]);
    expect([...routeOf('A', [a, b, c]).cableIds].sort()).toEqual(['A', 'B', 'C']);
  });
  it('rede grande não estoura', () => {
    const chain: Cable[] = [];
    for (let i = 0; i < 300; i++) chain.push(cable(`c${i}`, [E(i % 9), `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`, `00000000-0000-4000-8000-${String(1001 + i).padStart(12, '0')}`], i > 0 ? [L(`00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`, `c${i - 1}`)] : []));
    expect(routeOf('c299', chain).cableIds).toHaveLength(300);
  });
});

describe('planLinks', () => {
  it('ligar dois cabos num elemento: uma ligação a adicionar', () => {
    const plan = planLinks([T(), cable('D1', [E(2), E(4)]), solo()], E(2), new Set(['T', 'D1']));
    expect(plan.remove).toEqual([]);
    expect(plan.add).toEqual([{ elementId: E(2), a: 'D1', b: 'T' }]);
  });
  it('três cabos ligam todos com todos (3 pares)', () => {
    const c = [cable('A', [E(1)]), cable('B', [E(1)]), cable('C', [E(1)])];
    const plan = planLinks(c, E(1), new Set(['A', 'B', 'C']));
    expect(plan.add).toHaveLength(3);
    expect(plan.add.map((p) => `${p.a}${p.b}`).sort()).toEqual(['AB', 'AC', 'BC']);
  });
  it('o que já está ligado não se repete; desmarcar um cabo tira todas as ligações dele naquele elemento', () => {
    const a = cable('A', [E(1)], [L(E(1), 'B'), L(E(1), 'C')]);
    const b = cable('B', [E(1)], [L(E(1), 'C')]);
    const c = cable('C', [E(1)]);
    expect(planLinks([a, b, c], E(1), new Set(['A', 'B', 'C']))).toEqual({ add: [], remove: [] });
    const out = planLinks([a, b, c], E(1), new Set(['B', 'C']));
    expect(out.add).toEqual([]);
    expect(out.remove.map((p) => [p.a, p.b].sort().join('')).sort()).toEqual(['AB', 'AC']);
  });
  it('marcar só um cabo (ou nenhum) desfaz as ligações do elemento', () => {
    const cs = net();
    expect(planLinks(cs, E(2), new Set(['T'])).remove).toHaveLength(1);
    expect(planLinks(cs, E(2), new Set()).remove).toHaveLength(1);
    expect(planLinks(cs, E(2), new Set(['T'])).add).toEqual([]);
  });
  it('só desfaz ligações do elemento pedido', () => {
    expect(planLinks(net(), E(2), new Set()).remove.every((r) => r.elementId === E(2))).toBe(true);
    expect(planLinks(net(), E(1), new Set())).toEqual({ add: [], remove: [] });
  });
  it('cabo que não passa pelo elemento é ignorado', () => {
    const plan = planLinks([T(), solo()], E(2), new Set(['T', 'S']));
    expect(plan).toEqual({ add: [], remove: [] });
  });
});

describe('routeMeters', () => {
  const m = (id: string, total: number, deleted = false): Cable => ({ ...cable(id, [E(1)], [], deleted), totalMeters: total });
  it('soma o total dos cabos da rota, arredondado', () => {
    expect(routeMeters(['a', 'b'], [m('a', 10.123), m('b', 5.5), m('c', 100)])).toBe(15.62);
    expect(routeMeters([], [m('a', 10)])).toBe(0);
    expect(routeMeters(['x'], [m('a', 10)])).toBe(0);
  });
  it('cabo excluído não entra', () => {
    expect(routeMeters(['a', 'b'], [m('a', 10), m('b', 5, true)])).toBe(10);
  });
});

describe('connectionsOf', () => {
  it('as ligações do cabo, nos dois sentidos, com o outro cabo e o elemento', () => {
    expect(connectionsOf('D1', net())).toEqual([{ elementId: E(2), cableId: 'T' }, { elementId: E(5), cableId: 'D3' }]);
    expect(connectionsOf('T', net())).toEqual([{ elementId: E(2), cableId: 'D1' }, { elementId: E(3), cableId: 'D2' }]);
    expect(connectionsOf('S', net())).toEqual([]);
    expect(connectionsOf('nao-existe', net())).toEqual([]);
  });
});
