import { describe, expect, it } from 'vitest';
import { distanceMeters } from '../../lib/geo';
import { MAX_ACCURACY_M, MIN_DISTANCE_M, filterTrackPoint } from './trackFilter';

const A = { lat: -23.55, lng: -46.63 };
/** Ponto a `m` metros ao norte de A. */
const north = (m: number, accuracy = 5) => ({ lat: A.lat + m / 111_194.9266, lng: A.lng, accuracy });

describe('filtros da trilha (CLAUDE.md)', () => {
  it('as constantes são as do projeto', () => {
    expect(MAX_ACCURACY_M).toBe(30);
    expect(MIN_DISTANCE_M).toBe(5);
  });

  it('o primeiro ponto de um trecho é aceito (sem anterior)', () => {
    expect(filterTrackPoint(null, { ...A, accuracy: 10 })).toBe('aceito');
  });

  it('precisão pior que 30 m é descartada; 30 m ainda vale', () => {
    expect(filterTrackPoint(null, { ...A, accuracy: 30 })).toBe('aceito');
    expect(filterTrackPoint(null, { ...A, accuracy: 30.01 })).toBe('impreciso');
    expect(filterTrackPoint(null, { ...A, accuracy: 120 })).toBe('impreciso');
  });

  it('precisão inválida (NaN, infinito) é descartada, nunca aceita por engano', () => {
    expect(filterTrackPoint(null, { ...A, accuracy: NaN })).toBe('impreciso');
    expect(filterTrackPoint(null, { ...A, accuracy: Infinity })).toBe('impreciso');
  });

  it('ponto a menos de 5 m do anterior é descartado; a partir de 5 m vale', () => {
    expect(distanceMeters(A, north(4.9))).toBeCloseTo(4.9, 1);
    expect(filterTrackPoint(A, north(4.9))).toBe('proximo');
    expect(filterTrackPoint(A, north(5.1))).toBe('aceito');
    expect(filterTrackPoint(A, north(50))).toBe('aceito');
    expect(filterTrackPoint(A, { ...A, accuracy: 5 })).toBe('proximo'); // exatamente no mesmo lugar
  });

  it('a precisão é checada antes da distância (ponto ruim e perto conta como impreciso)', () => {
    expect(filterTrackPoint(A, north(1, 80))).toBe('impreciso');
  });
});
