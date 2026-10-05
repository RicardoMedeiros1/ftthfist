import { describe, expect, it } from 'vitest';
import { fitWithin } from './image';

describe('fitWithin', () => {
  it('paisagem grande: maior lado vira 1600', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 2000)).toEqual({ width: 1600, height: 1067 });
  });
  it('retrato grande: a altura vira 1600', () => {
    expect(fitWithin(2000, 3000)).toEqual({ width: 1067, height: 1600 });
  });
  it('nunca amplia', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it('lado mínimo é 1 px mesmo em proporções extremas', () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 1600, height: 1 });
  });
  it('aceita outro limite', () => {
    expect(fitWithin(1000, 500, 200)).toEqual({ width: 200, height: 100 });
  });
});
