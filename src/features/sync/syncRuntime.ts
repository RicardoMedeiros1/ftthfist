import { liveQuery } from 'dexie';
import { useSyncExternalStore } from 'react';
import { SETTING_KEYS, db, getSetting, setSetting } from '../../db/db';
import { accountStore } from '../account/accountStore';
import { isSupabaseConfigured, loadSupabaseClient } from '../account/supabaseClient';
import { createSyncEngine, type Who } from './engine';
import { createPhotoFiles } from './photoFiles';
import { SyncHttpError, createSupabaseRemote, type RemoteApi } from './remote';
import { createSyncStore, type SyncState } from './syncStore';

// Liga o motor e o estado da sincronizacao ao app de verdade (Dexie, conta, rede, tela).

let remote: Promise<RemoteApi> | null = null;
/** So carrega o supabase-js (e abre conexao) na primeira vez que ha o que enviar ou baixar. */
function loadRemote(): Promise<RemoteApi> {
  remote ??= loadSupabaseClient().then((client) => {
    if (!client) throw new SyncHttpError('permanent', 'app sem servidor');
    return createSupabaseRemote(client);
  });
  return remote.catch((e: unknown) => {
    remote = null; // sem internet na primeira vez: nao guarda a falha
    throw e instanceof SyncHttpError ? e : new SyncHttpError('network', 'nao deu para carregar o cliente do servidor');
  });
}

const lazyRemote: RemoteApi = {
  upsert: async (t, rows) => (await loadRemote()).upsert(t, rows),
  pull: async (t, q) => (await loadRemote()).pull(t, q),
  fetchByIds: async (t, ids) => (await loadRemote()).fetchByIds(t, ids),
  uploadFile: async (path, blob) => (await loadRemote()).uploadFile(path, blob),
  downloadFile: async (path) => (await loadRemote()).downloadFile(path),
};

/** Baixa o arquivo das fotos dos colegas ao abrir um elemento. Null se o app nao tem servidor. */
export const photoFiles = isSupabaseConfigured ? createPhotoFiles({ db, remote: lazyRemote }) : null;

export const syncEngine = isSupabaseConfigured ? createSyncEngine({ db, remote: lazyRemote, now: () => Date.now() }) : null;

function currentWho(): Who | null {
  const s = accountStore.getState();
  const userId = accountStore.currentUserId();
  return s.status === 'ativo' && userId && s.profile ? { userId, role: s.profile.role } : null;
}

export const syncStore = createSyncStore({
  engine: () => syncEngine,
  who: currentWho,
  isOnline: () => navigator.onLine,
  now: () => Date.now(),
  get: getSetting,
  set: setSetting,
  settingKey: SETTING_KEYS.syncLast,
  after: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
  watchCounts: (who, cb) => {
    if (!syncEngine) return () => undefined;
    const sub = liveQuery(() => syncEngine.counts(who)).subscribe({ next: cb, error: (e) => console.error('contagem de pendentes', e) });
    return () => sub.unsubscribe();
  },
  onOnline: (cb) => {
    window.addEventListener('online', cb);
    return () => window.removeEventListener('online', cb);
  },
  onVisible: (cb) => {
    const handler = () => document.visibilityState === 'visible' && cb();
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
  every: (ms, cb) => {
    const id = setInterval(() => document.visibilityState === 'visible' && navigator.onLine && cb(), ms);
    return () => clearInterval(id);
  },
});

/** Liga a sincronizacao: reage a mudancas da conta e arranca os gatilhos. Chamar uma vez, depois de iniciar a conta. */
export async function initSync(): Promise<void> {
  if (!syncEngine) return;
  accountStore.subscribe(() => syncStore.accountChanged());
  await syncStore.start();
}

export function useSync<T>(selector: (s: SyncState) => T): T {
  return useSyncExternalStore(
    syncStore.subscribe,
    () => selector(syncStore.getState()),
    () => selector(syncStore.getState()),
  );
}
