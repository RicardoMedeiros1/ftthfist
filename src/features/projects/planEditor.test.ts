import { describe, expect, it } from 'vitest';
import type { PlanLine, ProjectPlan } from '../../db/types';
import { PLAN_LIMITS, validatePlan } from './plan';
import {
  HISTORY_LIMIT, addLine, addPoint, appendVertex, canRedo, canUndo, cleanPlan, commit, deleteLine, deletePoint, deleteVertex, finishLine, insertVertex, isDirty,
  limitReached, midpoints, moveVertex, movePoint, newEditor, planToSave, pruneSelection, redo, roundCoord, setPointCode, setPointType, undo,
} from './planEditor';

const empty = (): ProjectPlan => ({ lines: [], points: [] });
const L = (id: string, ...pts: [number, number][]): PlanLine => ({ id, points: pts });
const base = (): ProjectPlan => ({ lines: [L('l1', [0, 0], [0, 1], [0, 2])], points: [{ id: 'p1', type: 'poste', lat: 1, lng: 1 }, { id: 'p2', type: 'cto', lat: 2, lng: 2, code: 'CTO-2' }] });

describe('roundCoord', () => {
  it('7 casas decimais', () => {
    expect(roundCoord(-23.123456789)).toBe(-23.1234568);
    expect(roundCoord(1)).toBe(1);
    expect(roundCoord(0.00000004)).toBe(0);
    expect(roundCoord(0.00000005)).toBe(0.0000001);
  });
});

describe('pontos projetados', () => {
  it('adiciona com id, tipo e posicao arredondada, sem mexer no original', () => {
    const plan = base();
    const out = addPoint(plan, 'p3', 'ceo', -23.123456789, -46.5);
    expect(out.points.at(-1)).toEqual({ id: 'p3', type: 'ceo', lat: -23.1234568, lng: -46.5 });
    expect(out.lines).toBe(plan.lines);
    expect(plan.points).toHaveLength(2);
  });
  it('id repetido e limite cheio: nada muda (mesmo objeto)', () => {
    const plan = base();
    expect(addPoint(plan, 'p1', 'poste', 5, 5)).toBe(plan);
    const full: ProjectPlan = { lines: [], points: Array.from({ length: PLAN_LIMITS.points }, (_, i) => ({ id: `x${i}`, type: 'poste' as const, lat: 0, lng: 0 })) };
    expect(addPoint(full, 'novo', 'poste', 1, 1)).toBe(full);
    expect(limitReached(full, 'ponto')).toBe(true);
    expect(limitReached(plan, 'ponto')).toBe(false);
  });
  it('mover: muda so aquele ponto; mesma posicao ou id que nao existe = mesmo objeto', () => {
    const plan = base();
    const out = movePoint(plan, 'p1', 10.123456789, 20);
    expect(out.points[0]).toMatchObject({ lat: 10.1234568, lng: 20 });
    expect(out.points[1]).toBe(plan.points[1]);
    expect(movePoint(plan, 'p1', 1, 1)).toBe(plan);
    expect(movePoint(plan, 'p1', 1.00000001, 1)).toBe(plan); // dentro do arredondamento
    expect(movePoint(plan, 'zzz', 5, 5)).toBe(plan);
  });
  it('tipo: troca; o mesmo tipo e id inexistente nao mudam nada', () => {
    const plan = base();
    expect(setPointType(plan, 'p1', 'ceo').points[0]!.type).toBe('ceo');
    expect(setPointType(plan, 'p1', 'poste')).toBe(plan);
    expect(setPointType(plan, 'zzz', 'ceo')).toBe(plan);
  });
  it('codigo: aparado, cortado no limite, vazio remove a chave, igual nao muda', () => {
    const plan = base();
    expect(setPointCode(plan, 'p1', '  P-77  ').points[0]).toEqual({ id: 'p1', type: 'poste', lat: 1, lng: 1, code: 'P-77' });
    expect(setPointCode(plan, 'p1', 'x'.repeat(100)).points[0]!.code).toHaveLength(PLAN_LIMITS.code);
    const cleared = setPointCode(plan, 'p2', '   ');
    expect('code' in cleared.points[1]!).toBe(false);
    expect(setPointCode(plan, 'p2', 'CTO-2')).toBe(plan);
    expect(setPointCode(plan, 'p1', '')).toBe(plan); // ja nao tinha
    expect(setPointCode(plan, 'zzz', 'a')).toBe(plan);
  });
  it('apagar', () => {
    const plan = base();
    expect(deletePoint(plan, 'p1').points.map((p) => p.id)).toEqual(['p2']);
    expect(deletePoint(plan, 'zzz')).toBe(plan);
  });
});

describe('traçados', () => {
  it('um traçado novo nasce com um ponto (rascunho)', () => {
    const out = addLine(empty(), 'a', 1.23456789, 2);
    expect(out.lines).toEqual([{ id: 'a', points: [[1.2345679, 2]] }]);
    expect(addLine(out, 'a', 5, 5)).toBe(out); // id repetido
  });
  it('limite de traçados', () => {
    const full: ProjectPlan = { lines: Array.from({ length: PLAN_LIMITS.lines }, (_, i) => L(`l${i}`, [0, 0], [1, 1])), points: [] };
    expect(addLine(full, 'novo', 1, 1)).toBe(full);
    expect(limitReached(full, 'linha')).toBe(true);
  });
  it('acrescentar no fim; repetir o mesmo lugar nao cria ponto repetido', () => {
    const plan = base();
    const out = appendVertex(plan, 'l1', 0, 3);
    expect(out.lines[0]!.points).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(appendVertex(out, 'l1', 0, 3)).toBe(out);
    expect(appendVertex(out, 'l1', 0.00000001, 3)).toBe(out);
    expect(appendVertex(plan, 'zzz', 9, 9)).toBe(plan);
  });
  it('inserir antes de uma posicao (0 e o fim valem); fora disso nada muda', () => {
    const plan = base();
    expect(insertVertex(plan, 'l1', 1, 5, 5).lines[0]!.points).toEqual([[0, 0], [5, 5], [0, 1], [0, 2]]);
    expect(insertVertex(plan, 'l1', 0, 5, 5).lines[0]!.points[0]).toEqual([5, 5]);
    expect(insertVertex(plan, 'l1', 3, 5, 5).lines[0]!.points.at(-1)).toEqual([5, 5]);
    expect(insertVertex(plan, 'l1', 4, 5, 5)).toBe(plan);
    expect(insertVertex(plan, 'l1', -1, 5, 5)).toBe(plan);
  });
  it('mover um ponto do traçado: so aquele; igual ou indice ruim = nada', () => {
    const plan = base();
    expect(moveVertex(plan, 'l1', 1, 7, 8).lines[0]!.points).toEqual([[0, 0], [7, 8], [0, 2]]);
    expect(moveVertex(plan, 'l1', 1, 7.123456789, 8).lines[0]!.points[1]).toEqual([7.1234568, 8]);
    expect(moveVertex(plan, 'l1', 1, 0, 1)).toBe(plan);
    expect(moveVertex(plan, 'l1', 9, 1, 1)).toBe(plan);
    expect(moveVertex(plan, 'l1', -1, 1, 1)).toBe(plan);
    expect(moveVertex(plan, 'zzz', 0, 1, 1)).toBe(plan);
  });
  it('apagar um ponto do traçado; com 2 pontos, apagar um apaga o traçado todo', () => {
    const plan = base();
    expect(deleteVertex(plan, 'l1', 1).lines[0]!.points).toEqual([[0, 0], [0, 2]]);
    const two = deleteVertex(plan, 'l1', 1);
    expect(deleteVertex(two, 'l1', 0).lines).toEqual([]);
    expect(deleteVertex(plan, 'l1', 5)).toBe(plan);
    expect(deleteVertex(plan, 'l1', -1)).toBe(plan);
    expect(deleteVertex(plan, 'zzz', 0)).toBe(plan);
    expect(deleteVertex({ lines: [L('d', [0, 0])], points: [] }, 'd', 0).lines).toEqual([]); // rascunho
  });
  it('apagar o traçado; terminar remove o rascunho de 1 ponto e mantem o que tem 2 ou mais', () => {
    const plan = base();
    expect(deleteLine(plan, 'l1').lines).toEqual([]);
    expect(deleteLine(plan, 'zzz')).toBe(plan);
    const draft = addLine(plan, 'd', 9, 9);
    expect(finishLine(draft, 'd').lines.map((l) => l.id)).toEqual(['l1']);
    expect(finishLine(plan, 'l1')).toBe(plan);
    expect(finishLine(plan, 'zzz')).toBe(plan);
  });
  it('limite de pontos: no traçado e no total', () => {
    const one: ProjectPlan = { lines: [{ id: 'g', points: Array.from({ length: PLAN_LIMITS.verticesPerLine }, () => [0, 0] as [number, number]) }], points: [] };
    expect(limitReached(one, 'vertice', 'g')).toBe(true);
    expect(appendVertex(one, 'g', 1, 1)).toBe(one);
    expect(insertVertex(one, 'g', 1, 1, 1)).toBe(one);
    expect(limitReached(one, 'vertice', 'outro-ainda-vazio')).toBe(false);
    const total: ProjectPlan = { lines: Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, points: Array.from({ length: 5000 }, () => [0, 0] as [number, number]) })).concat([L('x', [0, 0], [1, 1])]), points: [] };
    expect(limitReached(total, 'vertice', 'x')).toBe(true);
    // exatamente no limite do total (20000) ja nao cabe; um a menos ainda cabe
    expect(PLAN_LIMITS.vertices).toBe(20000);
    const nearFull = (count: number): ProjectPlan => ({
      lines: [...Array.from({ length: Math.floor(count / 5000) }, (_, i) => ({ id: `f${i}`, points: Array.from({ length: 5000 }, () => [0, 0] as [number, number]) })), { id: 'z', points: Array.from({ length: count % 5000 }, () => [0, 0] as [number, number]) }],
      points: [],
    });
    expect(limitReached(nearFull(20000), 'vertice', 'z')).toBe(true);
    expect(limitReached(nearFull(19999), 'vertice', 'z')).toBe(false);
  });
  it('pontos de meio dos trechos', () => {
    expect(midpoints(L('a', [0, 0], [2, 4], [2, 8]))).toEqual([{ index: 1, lat: 1, lng: 2 }, { index: 2, lat: 2, lng: 6 }]);
    expect(midpoints(L('a', [0, 0]))).toEqual([]);
  });
  it('as operacoes nunca alteram o desenho recebido', () => {
    const plan = base();
    const snapshot = JSON.stringify(plan);
    appendVertex(plan, 'l1', 5, 5); insertVertex(plan, 'l1', 1, 5, 5); moveVertex(plan, 'l1', 0, 9, 9); deleteVertex(plan, 'l1', 0); deleteLine(plan, 'l1');
    addPoint(plan, 'n', 'outro', 1, 1); movePoint(plan, 'p1', 9, 9); setPointCode(plan, 'p1', 'x'); setPointType(plan, 'p1', 'ceo'); deletePoint(plan, 'p1'); addLine(plan, 'z', 1, 1); finishLine(addLine(plan, 'z', 1, 1), 'z');
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});

describe('historico: desfazer e refazer', () => {
  it('cada mudanca e um passo; desfazer e refazer andam por eles', () => {
    let e = newEditor(empty());
    e = commit(e, addPoint(e.plan, 'a', 'poste', 1, 1));
    e = commit(e, addPoint(e.plan, 'b', 'cto', 2, 2));
    expect(e.plan.points).toHaveLength(2);
    expect([canUndo(e), canRedo(e)]).toEqual([true, false]);
    e = undo(e);
    expect(e.plan.points.map((p) => p.id)).toEqual(['a']);
    expect(canRedo(e)).toBe(true);
    e = undo(e);
    expect(e.plan.points).toEqual([]);
    expect(canUndo(e)).toBe(false);
    expect(undo(e)).toBe(e);
    e = redo(redo(e));
    expect(e.plan.points.map((p) => p.id)).toEqual(['a', 'b']);
    expect(redo(e)).toBe(e);
    e = undo(e); // depois de refazer, dá para desfazer de novo
    expect(e.plan.points.map((p) => p.id)).toEqual(['a']);
    expect(canUndo(e)).toBe(true);
  });
  it('uma mudanca nova apaga o "refazer"', () => {
    let e = newEditor(empty());
    e = commit(e, addPoint(e.plan, 'a', 'poste', 1, 1));
    e = undo(e);
    e = commit(e, addPoint(e.plan, 'b', 'poste', 2, 2));
    expect(canRedo(e)).toBe(false);
  });
  it('"mudar" para o mesmo desenho nao grava passo', () => {
    const e = newEditor(base());
    expect(commit(e, e.plan)).toBe(e);
    expect(commit(e, movePoint(e.plan, 'p1', 1, 1))).toBe(e);
  });
  it('guarda no maximo HISTORY_LIMIT passos (os mais antigos saem)', () => {
    let e = newEditor(empty());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) e = commit(e, addPoint(e.plan, `p${i}`, 'poste', 1, 1));
    expect(e.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i++) e = undo(e);
    expect(canUndo(e)).toBe(false);
    expect(e.plan.points).toHaveLength(20); // os 20 primeiros passos ja nao dao para desfazer
  });
});

describe('cleanPlan / planToSave / isDirty', () => {
  it('tira rascunho de 1 ponto, repetidos em sequencia, arredonda e apara; nao altera o original', () => {
    const dirty: ProjectPlan = {
      lines: [L('a', [0, 0], [0, 0], [0.00000001, 0], [1.123456789, 2], [1.123456789, 2]), L('draft', [5, 5]), L('same', [3, 3], [3, 3])],
      points: [{ id: 'p', type: 'cto', lat: 1.123456789, lng: 2, code: '  CTO  ' }, { id: 'q', type: 'poste', lat: 1, lng: 1, code: '   ' }],
    };
    const copy = JSON.stringify(dirty);
    const out = cleanPlan(dirty);
    expect(out.lines).toEqual([{ id: 'a', points: [[0, 0], [1.1234568, 2]] }]);
    expect(out.points).toEqual([{ id: 'p', type: 'cto', lat: 1.1234568, lng: 2, code: 'CTO' }, { id: 'q', type: 'poste', lat: 1, lng: 1 }]);
    expect(JSON.stringify(dirty)).toBe(copy);
    expect(validatePlan(out)).toBeNull();
  });
  it('o que se salva e sempre valido e vazio vira null (apaga o desenho)', () => {
    expect(planToSave(base())).toEqual(base());
    expect(planToSave(empty())).toBeNull();
    expect(planToSave({ lines: [L('d', [1, 1])], points: [] })).toBeNull(); // so rascunho
    const saved = planToSave({ lines: [L('d', [1, 1]), L('ok', [0, 0], [1, 1])], points: [] })!;
    expect(validatePlan(saved)).toBeNull();
  });
  it('mudou? compara o que seria enviado: rascunho e arredondamento nao contam', () => {
    expect(isDirty(base(), base())).toBe(false);
    expect(isDirty(base(), addPoint(base(), 'n', 'poste', 1, 1))).toBe(true);
    expect(isDirty(base(), addLine(base(), 'rasc', 1, 1))).toBe(false);
    expect(isDirty(base(), movePoint(base(), 'p1', 1.00000001, 1))).toBe(false);
    expect(isDirty(base(), movePoint(base(), 'p1', 1.1, 1))).toBe(true);
    expect(isDirty(empty(), base())).toBe(true);
    expect(isDirty(empty(), empty())).toBe(false);
  });
});

describe('pruneSelection', () => {
  it('mantem o que ainda existe e solta o que sumiu (depois de desfazer, por exemplo)', () => {
    const plan = base();
    expect(pruneSelection(null, plan)).toBeNull();
    expect(pruneSelection({ kind: 'point', id: 'p1' }, plan)).toEqual({ kind: 'point', id: 'p1' });
    expect(pruneSelection({ kind: 'point', id: 'zzz' }, plan)).toBeNull();
    expect(pruneSelection({ kind: 'line', id: 'l1' }, plan)).toEqual({ kind: 'line', id: 'l1' });
    expect(pruneSelection({ kind: 'line', id: 'zzz' }, plan)).toBeNull();
    expect(pruneSelection({ kind: 'vertex', lineId: 'l1', index: 2 }, plan)).toEqual({ kind: 'vertex', lineId: 'l1', index: 2 });
    expect(pruneSelection({ kind: 'vertex', lineId: 'l1', index: 3 }, plan)).toBeNull();
    expect(pruneSelection({ kind: 'vertex', lineId: 'zzz', index: 0 }, plan)).toBeNull();
  });
});
