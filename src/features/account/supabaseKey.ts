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
