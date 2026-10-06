import { SETTING_KEYS, type RotaFibraDB } from '../../db/db';

// O service worker nao enxerga o localStorage (onde o supabase-js guarda a sessao), entao o app copia para o IndexedDB
// o necessario para ele ENVIAR dados com o app fechado: o token de ACESSO (vale ~1 h), o endereco do servidor e a chave
// publica. O token de RENOVACAO nunca sai do supabase-js: se o service worker renovasse a sessao, o app perderia o
// login (cada token de renovacao so vale uma vez).

export interface AuthMirror {
  userId: string;
  accessToken: string;
  /** Segundos desde 1970, como no supabase-js. */
  expiresAt: number;
  url: string;
  /** Chave PUBLICA (Publishable/anon), a mesma do app. */
  key: string;
}

interface SessionLike {
  access_token: string;
  expires_at?: number;
  user: { id: string };
}

export async function writeAuthMirror(db: RotaFibraDB, session: SessionLike | null, server: { url: string; key: string }): Promise<void> {
  if (!session || !session.expires_at) {
    await db.settings.delete(SETTING_KEYS.authMirror);
    return;
  }
  const mirror: AuthMirror = { userId: session.user.id, accessToken: session.access_token, expiresAt: session.expires_at, ...server };
  await db.settings.put({ key: SETTING_KEYS.authMirror, value: mirror });
}

export async function readAuthMirror(db: RotaFibraDB): Promise<AuthMirror | null> {
  return ((await db.settings.get(SETTING_KEYS.authMirror))?.value as AuthMirror | undefined) ?? null;
}

/** O token ainda serve? Folga de 1 min: um token que vence no meio do envio so atrapalharia. */
export const TOKEN_SKEW_MS = 60_000;
export const tokenUsable = (m: AuthMirror | null, nowMs: number): m is AuthMirror => !!m && m.expiresAt * 1000 - TOKEN_SKEW_MS > nowMs;
