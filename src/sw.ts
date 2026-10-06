/// <reference lib="webworker" />
import { PostgrestClient } from '@supabase/postgrest-js';
import { StorageClient } from '@supabase/storage-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { db } from './db/db';
import type { AuthMirror } from './features/sync/authMirror';
import { BG_SYNC_TAG, runBackgroundSync, withSyncLock, type Notice } from './features/sync/background';
import { createSupabaseRemote } from './features/sync/remote';

// Service worker do RotaFibra:
//  1) o app abre offline (tudo precacheado) e os mapas ja visitados ficam disponiveis, com limite de entradas;
//  2) com a internet de volta e o app FECHADO, envia o que ficou pendente (Background Sync, Chrome/Android);
//  3) avisa por notificacao quando precisa que o tecnico abra o app (sessao vencida, registro recusado).

const sw = self as unknown as ServiceWorkerGlobalScope;

// ---------- offline (o mesmo que o plugin gerava antes) ----------
// O plugin troca exatamente o texto `self.__WB_MANIFEST` pela lista de arquivos do app: nao usar apelido aqui.
precacheAndRoute((self as unknown as { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }).__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL(new URL('index.html', sw.registration.scope).pathname)));
registerRoute(
  ({ url }) => url.hostname.endsWith('tile.openstreetmap.org') || url.hostname === 'server.arcgisonline.com',
  new CacheFirst({
    cacheName: 'map-tiles',
    plugins: [new ExpirationPlugin({ maxEntries: 2000, purgeOnQuotaError: true }), new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);
// "Atualizar" no aviso de nova versao (registerType: 'prompt')
sw.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void sw.skipWaiting();
});

// ---------- envio com o app fechado ----------
interface SyncEvent extends ExtendableEvent {
  tag: string;
  lastChance: boolean;
}

function remoteFor(m: AuthMirror) {
  const headers = { apikey: m.key, Authorization: `Bearer ${m.accessToken}` };
  const rest = new PostgrestClient(`${m.url}/rest/v1`, { headers });
  const storage = new StorageClient(`${m.url}/storage/v1`, headers);
  return createSupabaseRemote({ from: rest.from.bind(rest), storage } as unknown as Pick<SupabaseClient, 'from' | 'storage'>);
}

async function notify(n: Notice): Promise<void> {
  try {
    await sw.registration.showNotification(n.title, { body: n.body, tag: n.tag, icon: new URL('icon-192.png', sw.registration.scope).href });
  } catch {
    /* sem permissao para notificar: o envio continua valendo, so nao ha aviso */
  }
}

sw.addEventListener('sync', (event) => {
  const e = event as SyncEvent;
  if (e.tag !== BG_SYNC_TAG) return;
  e.waitUntil(
    (async () => {
      const outcome = await runBackgroundSync({ db, now: () => Date.now(), makeRemote: remoteFor, exclusive: withSyncLock, notify });
      // sem conexao ou servidor com problema: rejeitar faz o navegador tentar de novo mais tarde
      if (outcome === 'tentar-depois') throw new Error('envio adiado: sem conexao com o servidor');
    })(),
  );
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const open = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (open[0]) await open[0].focus();
      else await sw.clients.openWindow(sw.registration.scope);
    })(),
  );
});
