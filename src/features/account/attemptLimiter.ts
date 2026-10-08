// Limite de tentativas de acesso NESTE aparelho (conforto e freio contra tentativa e erro; quem protege de verdade é o limite do
// servidor). Depois de MAX_FAILS erros seguidos o aparelho espera: 5 min, depois 15 min, depois 30 min a cada nova trava.
// O estado fica salvo no aparelho, então recarregar a página não destrava.

export interface LimiterState {
  /** Erros seguidos desde a última trava (ou desde o último acerto). */
  fails: number;
  /** Quantas travas já aconteceram (define a duração da próxima). */
  strikes: number;
  /** Até quando o aparelho está travado (ms; 0 = livre). */
  lockedUntil: number;
  /** Quando foi o último erro (ms; 0 = nunca). */
  lastFailAt: number;
}

export const MAX_FAILS = 5;
export const LOCK_MINUTES = [5, 15, 30] as const;
/** Sem erro por tanto tempo, o histórico é esquecido (erros e travas). */
export const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;
/** O servidor respondeu "muitas tentativas": espera um pouco antes de insistir (sem contar como trava). */
export const SERVER_LIMIT_WAIT_MS = 2 * 60 * 1000;

export const EMPTY_LIMITER: LimiterState = { fails: 0, strikes: 0, lockedUntil: 0, lastFailAt: 0 };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Lê o que veio do armazenamento sem confiar no formato. */
export function normalizeLimiter(raw: unknown): LimiterState {
  if (typeof raw !== 'object' || raw === null) return EMPTY_LIMITER;
  const r = raw as Record<string, unknown>;
  return { fails: Math.floor(num(r.fails)), strikes: Math.floor(num(r.strikes)), lockedUntil: num(r.lockedUntil), lastFailAt: num(r.lastFailAt) };
}

export const remainingMs = (s: LimiterState, now: number): number => Math.max(0, s.lockedUntil - now);
export const isLocked = (s: LimiterState, now: number): boolean => remainingMs(s, now) > 0;

/** Um erro de acesso (senha errada, e-mail já cadastrado…). Na 5ª vez seguida o aparelho trava. */
export function recordFailure(s: LimiterState, now: number): LimiterState {
  if (isLocked(s, now)) return s;
  const stale = s.lastFailAt > 0 && now - s.lastFailAt > FORGET_AFTER_MS;
  const base = stale ? EMPTY_LIMITER : s;
  const fails = base.fails + 1;
  if (fails < MAX_FAILS) return { ...base, fails, lastFailAt: now };
  const minutes = LOCK_MINUTES[Math.min(base.strikes, LOCK_MINUTES.length - 1)]!;
  return { fails: 0, strikes: base.strikes + 1, lockedUntil: now + minutes * 60_000, lastFailAt: now };
}

/** Espera forçada (ex.: o servidor disse "muitas tentativas"), sem contar como erro nem como trava. */
export function lockFor(s: LimiterState, now: number, ms: number): LimiterState {
  return { ...s, lockedUntil: Math.max(s.lockedUntil, now + ms), lastFailAt: now };
}

export const recordSuccess = (): LimiterState => EMPTY_LIMITER;

/** "4:32" (minutos:segundos), arredondando para cima: nunca mostra 0:00 enquanto ainda está travado. */
export function formatWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Erros que contam como tentativa: o servidor recusou o acesso. Falta de rede e digitação errada de e-mail/senha nova não contam. */
export function countsAsAttempt(code: string): boolean {
  return !['network', 'weak_password', 'email_address_invalid', 'validation_failed', 'email_not_confirmed'].includes(code);
}

/** O servidor mandou esperar (limite dele)? */
export const isServerLimit = (code: string, status?: number): boolean =>
  code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || status === 429;
