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

let pending: Promise<AuthApi | null> | null = null;

/** O adaptador de autenticacao (ou null se o build nao foi configurado). */
export function loadAuthApi(): Promise<AuthApi | null> {
  if (!supabaseConfig) return Promise.resolve(null);
  pending ??= import('@supabase/supabase-js').then(({ createClient }) => {
    const client = createClient(supabaseConfig.url, supabaseConfig.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: STORAGE_KEY },
    });
    return createSupabaseAuthApi(client, STORAGE_KEY);
  });
  return pending;
}
