import { describe, expect, it } from 'vitest';
import { FIBER_COUNTS, LEGEND, cableStyle, isFiberCount } from './style';

describe('estilo do cabo por fibras', () => {
  it('todo nº de fibras válido tem um grupo na legenda, e cada um em um só grupo', () => {
    for (const n of FIBER_COUNTS) {
      expect(LEGEND.filter((l) => l.counts.includes(n))).toHaveLength(1);
    }
    expect(LEGEND.flatMap((l) => l.counts).sort((a, b) => a - b)).toEqual([...FIBER_COUNTS]);
  });

  it('mais fibras nunca é mais fino (a espessura também distingue, não só a cor)', () => {
    let prev = 0;
    for (const n of FIBER_COUNTS) {
      const w = cableStyle(n).weight;
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(cableStyle(144).weight).toBeGreaterThan(cableStyle(1).weight);
  });

  it('grupos diferentes têm cores diferentes', () => {
    expect(new Set(LEGEND.map((l) => l.color)).size).toBe(LEGEND.length);
  });

  it('o mesmo grupo compartilha estilo; valor desconhecido cai num cinza discreto', () => {
    expect(cableStyle(4)).toEqual(cableStyle(12));
    expect(cableStyle(1)).not.toEqual(cableStyle(4));
    expect(cableStyle(999)).toEqual({ color: '#9e9e9e', weight: 3 });
  });

  it('isFiberCount', () => {
    expect(isFiberCount(12)).toBe(true);
    expect(isFiberCount(10)).toBe(false);
    expect(isFiberCount('12')).toBe(false);
  });
});
