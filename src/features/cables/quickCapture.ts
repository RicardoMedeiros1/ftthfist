import { distanceMeters } from '../../lib/geo';
import { betterFix, type Fix } from '../elements/gpsCapture';

/** Janela curta: o técnico está parado no poste; não pode esperar 10 s a cada um. */
export const QUICK_MAX_MS = 4000;
/** Leituras dos últimos segundos antes do toque também valem (o GPS já estava ligado). */
export const QUICK_LOOKBACK_MS = 2000;
/** Precisão que encerra a espera antes do tempo. */
export const QUICK_GOOD_M = 5;

/** Leituras só valem juntas se estiverem perto da mais recente (ao menos 10 m, ou o erro dela). */
export const CONSISTENT_MIN_M = 10;

/**
 * A melhor leitura *do lugar onde o técnico está agora*. Sem isso, uma leitura precisa tirada no poste
 * anterior poderia vencer a leitura nova (pior, mas do lugar certo) e o poste seria gravado no lugar errado.
 */
export function consistentBest(fixes: Fix[]): Fix | null {
  if (fixes.length === 0) return null;
  const newest = fixes.reduce((a, b) => (b.timestamp >= a.timestamp ? b : a));
  const radius = Math.max(CONSISTENT_MIN_M, newest.accuracy);
  let best: Fix | null = null;
  for (const f of fixes) if (distanceMeters(f, newest) <= radius) best = betterFix(best, f);
  return best;
}

export interface QuickFeed {
  recent(sinceMs: number): Fix[];
}

/** Melhor leitura disponível agora ou nos próximos segundos; null se o GPS não deu sinal. */
export async function quickCapture(
  feed: QuickFeed,
  opts: {
    maxMs?: number;
    lookbackMs?: number;
    goodM?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Fix | null> {
  const { maxMs = QUICK_MAX_MS, lookbackMs = QUICK_LOOKBACK_MS, goodM = QUICK_GOOD_M } = opts;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  for (;;) {
    const best = consistentBest(feed.recent(start - lookbackMs));
    if (best && best.accuracy <= goodM) return best;
    if (now() - start >= maxMs) return best;
    await sleep(100);
  }
}
