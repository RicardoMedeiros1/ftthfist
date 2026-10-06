import { BG_SYNC_TAG } from './background';

// Lado do app do "envio com o app fechado": pede ao navegador para acordar o service worker quando a internet voltar.

interface SyncRegistration extends ServiceWorkerRegistration {
  sync?: { register(tag: string): Promise<void> };
}

/** O navegador acorda o service worker sozinho quando a internet volta? So Chrome/Edge no Android e no computador. */
export const backgroundSyncSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'SyncManager' in window;

/** Pede o envio em segundo plano. Falhas sao ignoradas: sem isso o app continua enviando quando for aberto. */
export async function requestBackgroundSync(): Promise<void> {
  if (!backgroundSyncSupported()) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as SyncRegistration;
    await reg.sync?.register(BG_SYNC_TAG);
  } catch {
    /* sem permissao, ou o service worker ainda nao esta ativo */
  }
}

/** Estado da permissao para notificar ('indisponivel' quando o navegador nao oferece). */
export const notificationState = (): NotificationPermission | 'indisponivel' =>
  typeof Notification === 'undefined' ? 'indisponivel' : Notification.permission;

/** Pede permissao para avisar (precisa de um toque do tecnico). */
export async function askNotificationPermission(): Promise<NotificationPermission | 'indisponivel'> {
  if (typeof Notification === 'undefined') return 'indisponivel';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}
