// Mantém a tela ligada durante a gravação da trilha (Screen Wake Lock API). Nem todo navegador oferece.

export type WakeLockResult = 'ativo' | 'indisponivel';

export interface WakeLockLike {
  acquire(): Promise<WakeLockResult>;
  release(): Promise<void>;
}

export function createWakeLock(nav: { wakeLock?: WakeLock } | undefined = typeof navigator !== 'undefined' ? navigator : undefined): WakeLockLike {
  let sentinel: WakeLockSentinel | null = null;
  return {
    async acquire() {
      if (!nav?.wakeLock) return 'indisponivel';
      try {
        sentinel = await nav.wakeLock.request('screen');
        return 'ativo';
      } catch {
        return 'indisponivel'; // ex.: economia de bateria ligada
      }
    },
    async release() {
      const s = sentinel;
      sentinel = null;
      try {
        await s?.release();
      } catch {
        /* já liberado pelo sistema */
      }
    },
  };
}
