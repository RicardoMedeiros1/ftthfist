import { describe, expect, it } from 'vitest';
import type { ProjectPlan } from '../../db/types';
import { PLAN_LIMITS, emptyPlan, isEmptyPlan, lineMeters, parsePlan, planBounds, planMeters, planSummary, validatePlan, vertexCount } from './plan';

const L = (id: string, ...pts: [number, number][]) => ({ id, points: pts });
const P = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'poste' as const, lat: -23.55, lng: -46.63, ...over });
const plan = (over: Partial<ProjectPlan> = {}): ProjectPlan => ({ lines: [L('l1', [-23.55, -46.63], [-23.551, -46.631])], points: [P('p1')], ...over });

describe('emptyPlan / isEmptyPlan', () => {
  it('vazio e sem linhas e sem pontos (e nulo tambem)', () => {
    expect(isEmptyPlan(emptyPlan())).toBe(true);
    expect(isEmptyPlan(null)).toBe(true);
    expect(isEmptyPlan(undefined)).toBe(true);
    expect(isEmptyPlan(plan())).toBe(false);
    expect(isEmptyPlan({ lines: [], points: [P('p')] })).toBe(false);
    expect(isEmptyPlan({ lines: [L('l', [0, 0], [1, 1])], points: [] })).toBe(false);
  });
});

describe('validatePlan', () => {
  it('um desenho bom (e um vazio) pode ser salvo', () => {
    expect(validatePlan(plan())).toBeNull();
    expect(validatePlan(emptyPlan())).toBeNull();
    expect(validatePlan({ lines: [], points: [P('p', { code: 'x'.repeat(PLAN_LIMITS.code), type: 'outro' })] })).toBeNull();
  });
  it('traçado com menos de 2 pontos nao serve', () => {
    expect(validatePlan(plan({ lines: [L('a', [0, 0])] }))).toMatch(/pelo menos 2 pontos/);
    expect(validatePlan(plan({ lines: [L('a')] }))).toMatch(/pelo menos 2 pontos/);
    expect(validatePlan(plan({ lines: [L('a', [0, 0], [1, 1])] }))).toBeNull();
  });
  it('coordenada fora do mundo, nao numerica ou no formato errado', () => {
    expect(validatePlan(plan({ lines: [L('a', [0, 0], [91, 0])] }))).toMatch(/fora do mapa/);
    expect(validatePlan(plan({ lines: [L('a', [0, 0], [0, 181])] }))).toMatch(/fora do mapa/);
    expect(validatePlan(plan({ lines: [L('a', [0, 0], [90, 180])] }))).toBeNull();
    expect(validatePlan(plan({ lines: [L('a', [0, 0], [Number.NaN, 0])] }))).toMatch(/fora do mapa/);
    expect(validatePlan(plan({ lines: [L('a', [0, 0], [Infinity, 0])] }))).toMatch(/fora do mapa/);
    expect(validatePlan(plan({ lines: [{ id: 'a', points: [[0, 0], [1, 2, 3] as unknown as [number, number]] }] }))).toMatch(/fora do mapa/);
    expect(validatePlan(plan({ points: [P('p', { lat: 91 })] }))).toMatch(/fora do mapa/);
    expect(validatePlan(plan({ points: [P('p', { lng: -181 })] }))).toMatch(/fora do mapa/);
    expect(validatePlan(plan({ points: [P('p', { lat: '1' })] }))).toMatch(/fora do mapa/);
  });
  it('tipo de ponto invalido e codigo grande demais', () => {
    expect(validatePlan(plan({ points: [P('p', { type: 'ocorrencia' })] }))).toMatch(/tipo inválido/);
    expect(validatePlan(plan({ points: [P('p', { type: 'nada' })] }))).toMatch(/tipo inválido/);
    expect(validatePlan(plan({ points: [P('p', { code: 'x'.repeat(PLAN_LIMITS.code + 1) })] }))).toMatch(/código/);
    expect(validatePlan(plan({ points: [P('p', { code: 7 })] }))).toMatch(/código/);
  });
  it('limites de quantidade', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => L(`l${i}`, [0, 0], [1, 1]));
    expect(validatePlan(plan({ lines: many(PLAN_LIMITS.lines) }))).toBeNull();
    expect(validatePlan(plan({ lines: many(PLAN_LIMITS.lines + 1) }))).toMatch(/traçados demais/);
    const pts = (n: number) => Array.from({ length: n }, (_, i) => P(`p${i}`));
    expect(validatePlan(plan({ points: pts(PLAN_LIMITS.points) }))).toBeNull();
    expect(validatePlan(plan({ points: pts(PLAN_LIMITS.points + 1) }))).toMatch(/pontos demais/);
    const line = (n: number) => L('big', ...Array.from({ length: n }, (_, i) => [0, i / 1e5] as [number, number]));
    expect(validatePlan({ lines: [line(PLAN_LIMITS.verticesPerLine)], points: [] })).toBeNull();
    expect(validatePlan({ lines: [line(PLAN_LIMITS.verticesPerLine + 1)], points: [] })).toMatch(/Um traçado tem pontos demais/);
    const flat = (n: number, id: string) => ({ id, points: Array.from({ length: n }, () => [0, 0] as [number, number]) });
    const full = [flat(5000, 'a'), flat(5000, 'b'), flat(5000, 'c'), flat(5000, 'd')];
    expect(validatePlan({ lines: full, points: [] })).toBeNull(); // exatamente 20000
    expect(validatePlan({ lines: [flat(5000, 'a'), flat(5000, 'b'), flat(5000, 'c'), flat(4999, 'd'), flat(2, 'e')], points: [] })).toMatch(/pontos de traçado demais/); // 20001
    const four = Array.from({ length: 5 }, (_, i) => ({ ...line(PLAN_LIMITS.verticesPerLine), id: `b${i}` }));
    expect(validatePlan({ lines: four, points: [] })).toMatch(/pontos de traçado demais/); // 25000 > 20000
  });
  it('tamanho em bytes: muito texto no codigo estoura antes de chegar ao servidor', () => {
    const fat = Array.from({ length: PLAN_LIMITS.points }, (_, i) => P(`p${i}`, { code: 'c'.repeat(PLAN_LIMITS.code), lat: -23.123456789012, lng: -46.123456789012 }));
    const longLine = L('big', ...Array.from({ length: PLAN_LIMITS.verticesPerLine }, (_, i) => [-23.123456789012 - i / 1e6, -46.123456789012] as [number, number]));
    expect(validatePlan({ lines: [], points: fat })).toBeNull(); // so os pontos ainda cabem
    expect(validatePlan({ lines: [longLine], points: fat })).toMatch(/grande demais/);
  });
});

describe('parsePlan (o que vem do servidor)', () => {
  it('le um desenho bom como esta', () => {
    expect(parsePlan(plan())).toEqual(plan());
  });
  it('nulo, vazio ou formato errado = sem desenho', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { lines: 'a', points: 3 }, { lines: [], points: [] }]) expect(parsePlan(bad)).toBeNull();
  });
  it('deixa de fora so o que e invalido, em vez de derrubar tudo', () => {
    const got = parsePlan({
      lines: [{ id: 'ok', points: [[0, 0], [1, 1]] }, { id: 'curta', points: [[0, 0]] }, { id: 'ruim', points: [[0, 0], [999, 0]] }, 'lixo', { id: 'x' }],
      points: [P('a'), P('b', { type: 'nada' }), P('c', { lat: 'x' }), null, P('d', { type: 'cto', code: 'CTO-1' })],
    });
    expect(got!.lines.map((l) => l.id)).toEqual(['ok']);
    expect(got!.points.map((p) => p.id)).toEqual(['a', 'd']);
    expect(got!.points[1]).toMatchObject({ type: 'cto', code: 'CTO-1' });
  });
  it('um vertice ruim some mas o traçado fica se sobrarem 2 ou mais', () => {
    const got = parsePlan({ lines: [{ id: 'l', points: [[0, 0], 'x', [1, 1], [99999, 0], [2, 2]] }], points: [] });
    expect(got!.lines[0]!.points).toEqual([[0, 0], [1, 1], [2, 2]]);
  });
  it('sem id, ganha um; codigo vazio ou nao texto some; codigo longo e cortado', () => {
    const got = parsePlan({ lines: [{ points: [[0, 0], [1, 1]] }], points: [{ type: 'poste', lat: 1, lng: 2 }, { id: '', type: 'ceo', lat: 1, lng: 2, code: '' }, { id: 'z', type: 'outro', lat: 1, lng: 2, code: 9 }, { id: 'w', type: 'poste', lat: 1, lng: 2, code: 'y'.repeat(100) }] });
    expect(got!.lines[0]!.id).toBe('linha-0');
    expect(got!.points.map((p) => p.id)).toEqual(['ponto-0', 'ponto-1', 'z', 'w']);
    expect(got!.points.map((p) => p.code)).toEqual([undefined, undefined, undefined, 'y'.repeat(PLAN_LIMITS.code)]);
    expect('code' in got!.points[0]!).toBe(false);
  });
  it('respeita os limites (o que passa e ignorado)', () => {
    const lines = Array.from({ length: PLAN_LIMITS.lines + 5 }, (_, i) => ({ id: `l${i}`, points: [[0, 0], [1, 1]] }));
    const points = Array.from({ length: PLAN_LIMITS.points + 5 }, (_, i) => P(`p${i}`));
    const got = parsePlan({ lines, points })!;
    expect(got.lines).toHaveLength(PLAN_LIMITS.lines);
    expect(got.points).toHaveLength(PLAN_LIMITS.points);
  });
  it('um traçado maior que o limite chega cortado no limite', () => {
    const big = { id: 'big', points: Array.from({ length: PLAN_LIMITS.verticesPerLine + 5 }, () => [1, 2]) };
    expect(parsePlan({ lines: [big], points: [] })!.lines[0]!.points).toHaveLength(PLAN_LIMITS.verticesPerLine);
  });
  it('o que ele devolve sempre passa na validacao', () => {
    const got = parsePlan({ lines: [{ id: 'a', points: [[0, 0], [1, 1], 'x'] }, { id: 'b', points: [[0, 0]] }], points: [P('p'), P('q', { type: 'zzz' })] })!;
    expect(validatePlan(got)).toBeNull();
  });
  it('nao altera o que recebeu', () => {
    const raw = { lines: [{ id: 'l', points: [[0, 0], [1, 1], 'x'] }], points: [] };
    const copy = JSON.stringify(raw);
    parsePlan(raw);
    expect(JSON.stringify(raw)).toBe(copy);
  });
});

describe('medidas', () => {
  it('limites: sul, oeste, norte e leste de linhas e pontos juntos; vazio = nulo', () => {
    expect(planBounds(emptyPlan())).toBeNull();
    expect(planBounds({ lines: [L('l', [-23.5, -46.6], [-23.6, -46.5])], points: [P('p', { lat: -23.7, lng: -46.9 })] })).toEqual([-23.7, -46.9, -23.5, -46.5]);
    expect(planBounds({ lines: [], points: [P('p', { lat: 1, lng: 2 })] })).toEqual([1, 2, 1, 2]);
    expect(planBounds({ lines: [L('l', [3, 4], [5, 6])], points: [] })).toEqual([3, 4, 5, 6]);
  });
  it('comprimento: um grau de latitude tem uns 111 km; soma varios traçados; ponto sozinho = 0', () => {
    expect(lineMeters(L('l', [0, 0], [1, 0]))).toBeGreaterThan(110_000);
    expect(lineMeters(L('l', [0, 0], [1, 0]))).toBeLessThan(112_000);
    expect(lineMeters(L('l', [0, 0]))).toBe(0);
    const a = L('a', [0, 0], [0.001, 0]);
    const b = L('b', [1, 1], [1.002, 1]);
    expect(planMeters({ lines: [a, b], points: [] })).toBeCloseTo(lineMeters(a) + lineMeters(b), 6);
    expect(planMeters(emptyPlan())).toBe(0);
  });
  it('conta os pontos de traçado de todas as linhas', () => {
    expect(vertexCount({ lines: [L('a', [0, 0], [1, 1]), L('b', [0, 0], [1, 1], [2, 2])], points: [P('p')] })).toBe(5);
  });
  it('resumo em portugues, no singular e no plural', () => {
    expect(planSummary(null)).toBe('Sem desenho');
    expect(planSummary(emptyPlan())).toBe('Sem desenho');
    expect(planSummary({ lines: [], points: [P('p')] })).toBe('1 ponto');
    expect(planSummary({ lines: [], points: [P('p'), P('q')] })).toBe('2 pontos');
    expect(planSummary({ lines: [L('l', [0, 0], [0.001, 0])], points: [] })).toBe('1 traçado (111 m)');
    expect(planSummary({ lines: [L('l', [0, 0], [0.001, 0]), L('m', [0, 0], [0.001, 0])], points: [P('p')] })).toBe('2 traçados (222 m) e 1 ponto');
  });
});
