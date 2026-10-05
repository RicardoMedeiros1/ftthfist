import { describe, expect, it } from 'vitest';
import { formatAgo, formatBytes, formatDateTime, formatDuration } from './format';

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

describe('formatAgo', () => {
  it('escolhe a unidade', () => {
    expect(formatAgo(10_000)).toBe('agora há pouco');
    expect(formatAgo(5 * 60_000)).toBe('há 5 min');
    expect(formatAgo(3 * 3_600_000)).toBe('há 3 h');
    expect(formatAgo(24 * 3_600_000)).toBe('há 1 dia');
    expect(formatAgo(5 * 24 * 3_600_000)).toBe('há 5 dias');
  });
});

describe('formatBytes', () => {
  it('escolhe a unidade', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12,4 MB');
  });
});
