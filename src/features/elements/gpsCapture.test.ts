import { describe, expect, it } from 'vitest';
import { CAPTURE_MAX_MS, NO_FIX_GIVE_UP_MS, betterFix, captureOutcome, type Fix } from './gpsCapture';

const fix = (accuracy: number, timestamp = 0): Fix => ({ lat: 0, lng: 0, accuracy, timestamp });

describe('betterFix', () => {
  it('a primeira leitura vira a melhor', () => {
    expect(betterFix(null, fix(30))).toEqual(fix(30));
  });
  it('fica com a de menor erro, mesmo que chegue depois uma pior', () => {
    let best = betterFix(null, fix(30, 1));
    best = betterFix(best, fix(9, 2));
    best = betterFix(best, fix(22, 3));
    expect(best.accuracy).toBe(9);
  });
  it('em empate escolhe a mais recente', () => {
    expect(betterFix(fix(8, 1), fix(8, 5)).timestamp).toBe(5);
    expect(betterFix(fix(8, 5), fix(8, 1)).timestamp).toBe(5);
  });
});

describe('captureOutcome', () => {
  it('encerra cedo com precisão de 5 m ou melhor', () => {
    expect(captureOutcome(fix(4.9), 1000)).toBe('concluir');
    expect(captureOutcome(fix(5), 1000)).toBe('concluir');
  });
  it('com precisão pior, continua até os 10 s e então conclui com a melhor', () => {
    expect(captureOutcome(fix(12), CAPTURE_MAX_MS - 1)).toBe('continuar');
    expect(captureOutcome(fix(12), CAPTURE_MAX_MS)).toBe('concluir');
  });
  it('sem nenhuma leitura, espera mais antes de falhar', () => {
    expect(captureOutcome(null, CAPTURE_MAX_MS + 5000)).toBe('continuar');
    expect(captureOutcome(null, NO_FIX_GIVE_UP_MS)).toBe('falhar');
  });
});
