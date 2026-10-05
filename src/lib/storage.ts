import { useCallback, useEffect, useState } from 'react';

export interface StorageInfo {
  /** true = o navegador não apaga os dados do app por falta de espaço; null = não dá para saber. */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export async function readStorageInfo(): Promise<StorageInfo> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const persisted = s?.persisted ? await s.persisted().catch(() => null) : null;
  const est = s?.estimate ? await s.estimate().catch(() => null) : null;
  return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
}

/** Pede ao navegador para não apagar os dados do app (instalado como PWA costuma ser concedido). */
export async function requestPersistence(): Promise<boolean> {
  const s = navigator.storage;
  if (!s?.persist) return false;
  try {
    return (await s.persisted()) || (await s.persist());
  } catch {
    return false;
  }
}

export function useStorageInfo() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const refresh = useCallback(() => void readStorageInfo().then(setInfo), []);
  useEffect(refresh, [refresh]);
  return { info, refresh };
}
