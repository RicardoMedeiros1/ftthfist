// Trava de seguranca: no app e no build so pode entrar a chave PUBLICA (Publishable / anon).
// A chave secreta (sb_secret_... ou a antiga service_role) ignora todas as regras de acesso: se alguem colar
// a errada numa variavel do GitHub, ela iria parar no site publico. Aqui ela e recusada.

export type KeyKind = 'publica' | 'secreta' | 'invalida';

function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

/** sb_publishable_... e a anon (JWT com role "anon") sao publicas; sb_secret_... e service_role, nunca. */
export function classifyKey(raw: string | undefined | null): KeyKind {
  const key = (raw ?? '').trim();
  if (!key) return 'invalida';
  if (/^sb_secret_/i.test(key)) return 'secreta';
  if (/^sb_publishable_/i.test(key)) return 'publica';
  const role = jwtRole(key);
  if (role === 'service_role' || (role !== null && role !== 'anon')) return 'secreta';
  if (role === 'anon') return 'publica';
  return 'invalida';
}

export interface SupabaseConfig {
  url: string;
  key: string;
}

/** Configuracao valida ou null (sem variaveis = o app funciona normalmente, so sem conta). Chave secreta = erro. */
export function readConfig(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }): SupabaseConfig | null {
  const url = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url && !key) return null;
  const kind = classifyKey(key);
  if (kind === 'secreta') {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY contem uma chave SECRETA (service_role / sb_secret_). Use a Publishable key. Nada foi publicado.',
    );
  }
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(url) || kind !== 'publica') return null;
  return { url, key };
}

export type ConfigStatus = 'ligado' | 'vazio' | 'so-url' | 'so-chave' | 'url-invalida' | 'chave-invalida';

/** Diagnostico em portugues do que o build recebeu (nunca inclui valores). Chave secreta lanca, como em readConfig. */
export function describeConfig(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }): { status: ConfigStatus; message: string } {
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (readConfig(env)) return { status: 'ligado', message: 'Supabase: configurado (login ligado neste build).' };
  if (!url && !key) return { status: 'vazio', message: 'Supabase: NAO configurado (as duas variaveis estao vazias ou ausentes). O app sai sem a conta.' };
  if (!url) return { status: 'so-chave', message: 'Supabase: NAO configurado: falta VITE_SUPABASE_URL (so a chave chegou). O app sai sem a conta.' };
  if (!key) return { status: 'so-url', message: 'Supabase: NAO configurado: falta VITE_SUPABASE_ANON_KEY (so a URL chegou). O app sai sem a conta.' };
  if (classifyKey(key) !== 'publica') return { status: 'chave-invalida', message: 'Supabase: NAO configurado: VITE_SUPABASE_ANON_KEY nao parece uma Publishable key (deve comecar com sb_publishable_). O app sai sem a conta.' };
  return { status: 'url-invalida', message: 'Supabase: NAO configurado: VITE_SUPABASE_URL invalida (use o formato https://xxxx.supabase.co, com https:// e sem caminho). O app sai sem a conta.' };
}
