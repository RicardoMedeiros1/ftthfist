import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDuration } from './format';

describe('formatDuration', () => {
  it('abaixo de 1 min mostra 0 min', () => expect(formatDuration(59_000)).toBe('0 min'));
  it('minutos', () => expect(formatDuration(5 * 60_000)).toBe('5 min'));
  it('horas e minutos com zero à esquerda', () => expect(formatDuration(65 * 60_000)).toBe('1 h 05 min'));
  it('valor negativo vira 0 min', () => expect(formatDuration(-1000)).toBe('0 min'));
});

describe('formatDateTime', () => {
  it('usa dia/mês e hora:minuto', () => {
    expect(formatDateTime(new Date(2026, 9, 5, 14, 7).getTime())).toMatch(/05\/10.*14:07/);
  });
});
