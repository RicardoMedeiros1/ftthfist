import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../../db/db';
import { writeAuthMirror } from '../sync/authMirror';
import { createSupabaseAuthApi, type AuthApi } from './authApi';
import { readConfig, type SupabaseConfig } from './supabaseKey';

// Cliente do Supabase: carregado sob demanda (fora do pacote inicial), para o app abrir tao rapido quanto antes
// e continuar abrindo sem internet. So existe quando as variaveis do build estao preenchidas.

export const STORAGE_KEY = 'rotafibra-auth';

function resolve(): SupabaseConfig | null {
  try {
    return readConfig(import.meta.env);
  } catch {
    return null; // chave secreta: o build ja teria falhado; por garantia o app nao usa
  }
}

export const supabaseConfig: SupabaseConfig | null = resolve();
export const isSupabaseConfigured = supabaseConfig !== null;

let pendingClient: Promise<SupabaseClient | null> | null = null;
let pendingAuth: Promise<AuthApi | null> | null = null;

/** O cliente do Supabase (um so para o login e a sincronizacao), ou null se o build nao foi configurado. */
export function loadSupabaseClient(): Promise<SupabaseClient | null> {
  if (!supabaseConfig) return Promise.resolve(null);
  pendingClient ??= import('@supabase/supabase-js')
    .then(({ createClient }) => {
      const client = createClient(supabaseConfig.url, supabaseConfig.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: STORAGE_KEY },
      });
      // Copia o token de ACESSO para o IndexedDB: o service worker (que nao enxerga o localStorage) usa para enviar com o
      // app fechado. O token de renovacao nunca sai do supabase-js. Sair da conta apaga a copia.
      client.auth.onAuthStateChange((_event, session) => {
        void writeAuthMirror(db, session, { url: supabaseConfig.url, key: supabaseConfig.key }).catch(() => undefined);
      });
      return client;
    })
    .catch((e: unknown) => {
      pendingClient = null; // sem internet na primeira vez: tenta de novo na proxima
      throw e;
    });
  return pendingClient;
}

/** O adaptador de autenticacao (ou null se o build nao foi configurado). */
export function loadAuthApi(): Promise<AuthApi | null> {
  if (!supabaseConfig) return Promise.resolve(null);
  pendingAuth ??= loadSupabaseClient()
    .then((client) => (client ? createSupabaseAuthApi(client, STORAGE_KEY) : null))
    .catch((e: unknown) => {
      pendingAuth = null;
      throw e;
    });
  return pendingAuth;
}
