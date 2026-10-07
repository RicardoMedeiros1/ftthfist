import { useSyncExternalStore } from 'react';
import { mapCommands } from '../map/mapCommands';
import { panelMapStore } from '../panel/panelMapStore';
import { isSupabaseConfigured, loadSupabaseClient } from '../account/supabaseClient';
import { AdminError, createSupabaseAdminApi, type AdminApi } from './adminApi';
import { createRemoteTrackStore, type RemoteTrackState } from './remoteTrack';

// Liga as ferramentas do administrador ao cliente do Supabase (carregado so quando a tela e aberta).

let api: Promise<AdminApi> | null = null;
function load(): Promise<AdminApi> {
  api ??= loadSupabaseClient().then((client) => {
    if (!client) throw new AdminError('other', 'app sem servidor');
    return createSupabaseAdminApi(client);
  });
  return api.catch((e: unknown) => {
    api = null; // sem internet na primeira vez: nao guarda a falha
    throw e instanceof AdminError ? e : new AdminError('network', 'nao deu para carregar o cliente do servidor');
  });
}

/** Null quando o app nao esta ligado a um servidor. */
export const adminApi: AdminApi | null = isSupabaseConfigured
  ? {
      listPeople: async () => (await load()).listPeople(),
      setAccess: async (id, patch) => (await load()).setAccess(id, patch),
      listEdits: async (limit, before) => (await load()).listEdits(limit, before),
      listConflicts: async (limit, before) => (await load()).listConflicts(limit, before),
      names: async (ids) => (await load()).names(ids),
      trackPage: async (a, limit, after) => (await load()).trackPage(a, limit, after),
    }
  : null;

/** A trilha do tecnico que o administrador pediu para ver (uma por vez). Enquadra o mapa quando chega. */
export const remoteTrackStore = createRemoteTrackStore({
  api: () => adminApi,
  onReady: (bounds) => {
    if (!bounds) return;
    // quem pediu a trilha estava no painel? entao e o mapa do painel que enquadra (o do app de campo fica atras dele)
    if (window.location.hash.startsWith('#/painel')) panelMapStore.requestFit(bounds);
    else if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) mapCommands.center(bounds[0], bounds[1], 19);
    else mapCommands.fitBounds(bounds);
  },
});

export const useRemoteTrack = (): RemoteTrackState =>
  useSyncExternalStore(remoteTrackStore.subscribe, remoteTrackStore.getState, remoteTrackStore.getState);
