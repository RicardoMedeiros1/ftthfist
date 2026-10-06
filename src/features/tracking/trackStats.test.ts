import { describe, expect, it } from 'vitest';
import { pathLengthMeters } from '../../lib/geo';
import { groupSegments, thinForDisplay, trackDistanceMeters } from './trackStats';

const pt = (lat: number, lng: number, timestamp: number, segment?: number) => ({ lat, lng, timestamp, ...(segment === undefined ? {} : { segment }) });

describe('groupSegments', () => {
  it('separa por trecho, em ordem, e ordena cada trecho por horário', () => {
    const g = groupSegments([pt(1, 1, 30, 1), pt(1, 1, 20, 0), pt(1, 1, 10, 0), pt(1, 1, 5, 1)]);
    expect(g.map((s) => s.map((p) => p.timestamp))).toEqual([[10, 20], [5, 30]]);
  });
  it('pontos sem trecho (gravados antes do campo existir) caem no trecho 0', () => {
    expect(groupSegments([pt(1, 1, 2), pt(1, 1, 1, 0)])).toHaveLength(1);
  });
  it('lista vazia', () => expect(groupSegments([])).toEqual([]));
});

describe('trackDistanceMeters', () => {
  const a = [pt(-23.55, -46.63, 1, 0), pt(-23.5503, -46.6301, 2, 0)];
  const b = [pt(-23.56, -46.64, 3, 1), pt(-23.5603, -46.6401, 4, 1)];
  it('soma os trechos e NÃO mede o salto entre eles (pausa/tela apagada)', () => {
    const total = trackDistanceMeters([...a, ...b]);
    expect(total).toBeCloseTo(pathLengthMeters(a) + pathLengthMeters(b), 6);
    expect(total).toBeLessThan(pathLengthMeters([...a, ...b])); // a linha reta entre trechos seria bem maior
  });
  it('um ponto só ou nenhum: zero', () => {
    expect(trackDistanceMeters([pt(1, 1, 1)])).toBe(0);
    expect(trackDistanceMeters([])).toBe(0);
  });
});

describe('thinForDisplay', () => {
  it('trilhas pequenas ficam como estão', () => {
    const s = Array.from({ length: 100 }, (_, i) => i);
    expect(thinForDisplay(s)).toBe(s);
  });
  it('trilhas grandes são reduzidas, mantendo o primeiro e o último ponto', () => {
    const s = Array.from({ length: 10_000 }, (_, i) => i);
    const t = thinForDisplay(s, 1500);
    expect(t.length).toBeLessThanOrEqual(1500 + 1);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(9999);
  });
});
