import { describe, expect, it } from 'vitest';
import type { Cable } from '../../db/types';
import { MARKER_LIMIT, boxOf, boxesIntersect, cablesInBox, padBox, pointInBox } from './viewport';

const cable = (vs: Array<[number, number]>): Cable => ({ id: 'c', vertices: vs.map(([lat, lng]) => ({ lat, lng })) }) as Cable;

describe('caixas', () => {
  it('boxOf: [sul, oeste, norte, leste]; vazio = null', () => {
    expect(boxOf([])).toBeNull();
    expect(boxOf([{ lat: -23.5, lng: -46.7 }, { lat: -23.4, lng: -46.6 }, { lat: -23.6, lng: -46.65 }])).toEqual([-23.6, -46.7, -23.4, -46.6]);
  });
  it('pointInBox inclui a borda e exclui o que esta fora, nos quatro lados', () => {
    const b: [number, number, number, number] = [0, 0, 10, 10];
    expect(pointInBox({ lat: 5, lng: 5 }, b)).toBe(true);
    expect(pointInBox({ lat: 0, lng: 10 }, b)).toBe(true);
    for (const p of [{ lat: -0.1, lng: 5 }, { lat: 10.1, lng: 5 }, { lat: 5, lng: -0.1 }, { lat: 5, lng: 10.1 }]) expect(pointInBox(p, b)).toBe(false);
  });
  it('boxesIntersect: sobrepoe, encosta, e separadas em cada eixo', () => {
    const a: [number, number, number, number] = [0, 0, 10, 10];
    expect(boxesIntersect(a, [5, 5, 15, 15])).toBe(true);
    expect(boxesIntersect(a, [10, 10, 20, 20])).toBe(true);
    expect(boxesIntersect(a, [11, 0, 20, 10])).toBe(false);
    expect(boxesIntersect(a, [0, 11, 10, 20])).toBe(false);
    expect(boxesIntersect(a, [-20, 0, -1, 10])).toBe(false);
    expect(boxesIntersect(a, [0, -20, 10, -1])).toBe(false);
    expect(boxesIntersect([2, 2, 3, 3], a)).toBe(true); // uma dentro da outra
  });
  it('padBox aumenta cada lado proporcionalmente', () => {
    expect(padBox([0, 0, 10, 20], 0.1)).toEqual([-1, -2, 11, 22]);
  });
});

describe('cablesInBox', () => {
  const screen: [number, number, number, number] = [0, 0, 10, 10];
  it('cabo com vertice na tela, e cabo comprido que so atravessa a tela', () => {
    expect(cablesInBox([cable([[5, 5], [6, 6]])], screen)).toHaveLength(1);
    expect(cablesInBox([cable([[-5, 5], [15, 5]])], screen)).toHaveLength(1); // atravessa sem vertice dentro
  });
  it('cabo inteiro fora da tela nao entra; cabo sem vertices nao quebra', () => {
    expect(cablesInBox([cable([[20, 20], [30, 30]]), cable([])], screen)).toEqual([]);
  });
});

describe('limite de simbolos', () => {
  it('e um numero razoavel para o navegador desenhar de uma vez', () => {
    expect(MARKER_LIMIT).toBeGreaterThanOrEqual(500);
    expect(MARKER_LIMIT).toBeLessThanOrEqual(5000);
  });
});
