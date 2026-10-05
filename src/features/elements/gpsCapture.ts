// Regras da captura de posição por GPS ao marcar um elemento (sem dependência de navegador).

/** Espera até ~10 s pela melhor precisão. */
export const CAPTURE_MAX_MS = 10_000;
/** Precisão boa o bastante para encerrar antes dos 10 s. */
export const GOOD_ENOUGH_M = 5;
/** Sem nenhuma leitura, o GPS "frio" pode demorar: espera mais antes de desistir. */
export const NO_FIX_GIVE_UP_MS = 30_000;

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number; // metros
  timestamp: number;
}

/** Fica com a leitura de menor erro; em empate, a mais recente. */
export function betterFix(current: Fix | null, candidate: Fix): Fix {
  if (!current) return candidate;
  if (candidate.accuracy < current.accuracy) return candidate;
  if (candidate.accuracy === current.accuracy && candidate.timestamp > current.timestamp) return candidate;
  return current;
}

export type CaptureOutcome = 'continuar' | 'concluir' | 'falhar';

export function captureOutcome(best: Fix | null, elapsedMs: number): CaptureOutcome {
  if (best && (best.accuracy <= GOOD_ENOUGH_M || elapsedMs >= CAPTURE_MAX_MS)) return 'concluir';
  if (!best && elapsedMs >= NO_FIX_GIVE_UP_MS) return 'falhar';
  return 'continuar';
}
