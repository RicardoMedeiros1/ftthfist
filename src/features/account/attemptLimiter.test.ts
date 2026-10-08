import { describe, expect, it } from 'vitest';
import {
  EMPTY_LIMITER,
  FORGET_AFTER_MS,
  LOCK_MINUTES,
  MAX_FAILS,
  SERVER_LIMIT_WAIT_MS,
  countsAsAttempt,
  formatWait,
  isLocked,
  isServerLimit,
  lockFor,
  normalizeLimiter,
  recordFailure,
  recordSuccess,
  remainingMs,
  type LimiterState,
} from './attemptLimiter';

const MIN = 60_000;
const failTimes = (s: LimiterState, n: number, at: number) => {
  for (let i = 0; i < n; i++) s = recordFailure(s, at);
  return s;
};

describe('limite de tentativas no aparelho', () => {
  it('os primeiros erros só contam; na 5ª vez seguida trava por 5 minutos', () => {
    let s = EMPTY_LIMITER;
    for (let i = 1; i < MAX_FAILS; i++) {
      s = recordFailure(s, 1000);
      expect(s.fails).toBe(i);
      expect(isLocked(s, 1000)).toBe(false);
    }
    s = recordFailure(s, 1000);
    expect(isLocked(s, 1000)).toBe(true);
    expect(remainingMs(s, 1000)).toBe(5 * MIN);
    expect(s).toMatchObject({ fails: 0, strikes: 1 });
  });

  it('a trava acaba sozinha e a próxima é mais longa: 5, 15 e 30 minutos (depois fica em 30)', () => {
    let s = EMPTY_LIMITER;
    let now = 1000;
    const waits: number[] = [];
    for (let strike = 0; strike < 5; strike++) {
      s = failTimes(s, MAX_FAILS, now);
      waits.push(remainingMs(s, now) / MIN);
      now = s.lockedUntil + 1; // esperou
      expect(isLocked(s, now)).toBe(false);
    }
    expect(waits).toEqual([...LOCK_MINUTES, 30, 30]);
  });

  it('enquanto está travado, novos erros não mudam nada', () => {
    const locked = failTimes(EMPTY_LIMITER, MAX_FAILS, 1000);
    expect(recordFailure(locked, 2000)).toBe(locked);
  });

  it('um acerto zera tudo', () => {
    const s = failTimes(EMPTY_LIMITER, MAX_FAILS - 1, 1000);
    expect(recordSuccess()).toEqual(EMPTY_LIMITER);
    expect(recordFailure(recordSuccess(), 2000).fails).toBe(1);
    expect(s.fails).toBe(MAX_FAILS - 1);
  });

  it('mais de 24 horas sem erro: o histórico é esquecido (erros e travas)', () => {
    const old = { ...failTimes(EMPTY_LIMITER, 3, 1000), strikes: 2 };
    const later = recordFailure(old, 1000 + FORGET_AFTER_MS + 1);
    expect(later).toMatchObject({ fails: 1, strikes: 0 });
    // dentro das 24 horas continua contando
    expect(recordFailure(old, 1000 + FORGET_AFTER_MS - 1).fails).toBe(4);
  });

  it('espera imposta pelo servidor não conta como erro nem como trava e nunca encurta uma trava maior', () => {
    const w = lockFor(EMPTY_LIMITER, 5000, SERVER_LIMIT_WAIT_MS);
    expect(w).toMatchObject({ fails: 0, strikes: 0, lockedUntil: 5000 + SERVER_LIMIT_WAIT_MS });
    const long = failTimes(EMPTY_LIMITER, MAX_FAILS, 5000);
    expect(lockFor(long, 5000, SERVER_LIMIT_WAIT_MS).lockedUntil).toBe(long.lockedUntil);
  });

  it('só conta o que é recusa do servidor: rede, senha fraca, e-mail inválido e e-mail não confirmado não contam', () => {
    for (const code of ['invalid_credentials', 'user_already_exists', 'email_exists', 'desconhecido', 'over_request_rate_limit']) expect(countsAsAttempt(code)).toBe(true);
    for (const code of ['network', 'weak_password', 'email_address_invalid', 'validation_failed', 'email_not_confirmed']) expect(countsAsAttempt(code)).toBe(false);
  });

  it('reconhece o "muitas tentativas" do servidor', () => {
    expect(isServerLimit('over_request_rate_limit')).toBe(true);
    expect(isServerLimit('over_email_send_rate_limit')).toBe(true);
    expect(isServerLimit('desconhecido', 429)).toBe(true);
    expect(isServerLimit('invalid_credentials', 400)).toBe(false);
  });

  it('formata a espera como minutos:segundos, arredondando para cima', () => {
    expect(formatWait(5 * MIN)).toBe('5:00');
    expect(formatWait(4 * MIN + 32_000)).toBe('4:32');
    expect(formatWait(1)).toBe('0:01');
    expect(formatWait(61_000)).toBe('1:01');
    expect(formatWait(-5)).toBe('0:00');
  });

  it('lê do armazenamento sem confiar no formato', () => {
    expect(normalizeLimiter(null)).toBe(EMPTY_LIMITER);
    expect(normalizeLimiter('x')).toBe(EMPTY_LIMITER);
    expect(normalizeLimiter({ fails: '3', strikes: -1, lockedUntil: NaN, lastFailAt: Infinity })).toEqual(EMPTY_LIMITER);
    expect(normalizeLimiter({ fails: 2.7, strikes: 1, lockedUntil: 9000, lastFailAt: 8000 })).toEqual({ fails: 2, strikes: 1, lockedUntil: 9000, lastFailAt: 8000 });
  });
});
