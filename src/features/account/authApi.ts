import type { SupabaseClient } from '@supabase/supabase-js';

// A "porta" do app para o Supabase Auth. O resto do app so conhece esta interface (e os testes usam uma falsa).

export interface AuthSession {
  userId: string;
  email: string;
}

export type Role = 'tecnico' | 'escritorio' | 'admin';

export interface AccountProfile {
  id: string;
  fullName: string;
  role: Role;
  active: boolean;
  /** O admin ja analisou (aprovou ou desativou). active=false e reviewed=false = pedido pendente. */
  reviewed: boolean;
}

export interface AuthApi {
  /** null = nao ha sessao. Lanca AuthApiError('network') quando nao deu para saber (sem internet). */
  getSession(): Promise<AuthSession | null>;
  onChange(cb: (s: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthSession>;
  /** null = cadastro feito mas sem sessao (o projeto exige confirmar o e-mail). */
  signUp(email: string, password: string, fullName: string): Promise<AuthSession | null>;
  signOut(): Promise<void>;
  updatePassword(password: string): Promise<void>;
  fetchProfile(userId: string): Promise<AccountProfile | null>;
}

export class AuthApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

/** Mensagem para o tecnico, em portugues, sem jargao. */
export function translateAuthError(e: unknown): string {
  const err = e as { code?: string; status?: number; message?: string; name?: string } | null;
  const code = err?.code ?? '';
  const msg = err?.message ?? '';
  const status = err?.status;
  if (code === 'network' || err?.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar.';
  if (code === 'user_already_exists' || code === 'email_exists' || /already (registered|been registered)/i.test(msg)) {
    return 'Este e-mail já tem cadastro. Use "Entrar" (se o pedido ainda não foi aprovado, aguarde o administrador).';
  }
  // (a ordem importa: "New password should be different..." tambem fala de senha, mas nao e senha fraca)
  if (code === 'same_password' || /should be different|same as the old/i.test(msg)) return 'A nova senha precisa ser diferente da atual.';
  if (code === 'weak_password' || /password.*(at least|weak)/i.test(msg)) {
    return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.';
  }
  if (code === 'signup_disabled' || /signups? (not allowed|disabled)/i.test(msg)) {
    return 'O cadastro está fechado no momento. Fale com o administrador.';
  }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || status === 429) {
    return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed' || /invalid.*email|email.*invalid/i.test(msg)) {
    return 'E-mail inválido. Confira como foi digitado.';
  }
  if (['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt', 'session_expired'].includes(code) || status === 401) {
    return 'Sua sessão expirou. Entre de novo.';
  }
  if (typeof status === 'number' && status >= 500) return 'O servidor está com problema. Tente de novo em alguns minutos.';
  return 'Não foi possível concluir. Tente de novo.';
}

const ROLES: readonly Role[] = ['tecnico', 'escritorio', 'admin'];

function wrap(e: unknown): AuthApiError {
  const err = e as { code?: string; status?: number; message?: string; name?: string };
  const message = err?.message ?? 'erro';
  const network = err?.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed|network request failed/i.test(message);
  return new AuthApiError(network ? 'network' : (err?.code ?? 'desconhecido'), message, err?.status);
}

/** Adaptador do supabase-js. `storageKey` e a chave do localStorage onde ele guarda a sessao. */
export function createSupabaseAuthApi(client: SupabaseClient, storageKey: string, opts: { sessionTimeoutMs?: number } = {}): AuthApi {
  const sessionTimeoutMs = opts.sessionTimeoutMs ?? 10_000;
  const toSession = (s: { user: { id: string; email?: string | undefined } } | null): AuthSession | null =>
    s ? { userId: s.user.id, email: s.user.email ?? '' } : null;

  return {
    async getSession() {
      // Com o token vencido e sem internet o supabase-js tenta renovar por ~25 s (8 tentativas) antes de desistir:
      // esperamos no maximo `sessionTimeoutMs` e tratamos como "nao deu para saber" (NAO como deslogado).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AuthApiError('network', 'tempo esgotado ao verificar a sessao')), sessionTimeoutMs);
      });
      try {
        const { data, error } = await Promise.race([client.auth.getSession(), timeout]);
        if (error) throw wrap(error);
        return toSession(data.session);
      } finally {
        clearTimeout(timer);
      }
    },
    onChange(cb) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        // So "saiu" de verdade (SIGNED_OUT) vira logout. Um INITIAL_SESSION sem sessao pode ser apenas "token vencido
        // e sem internet" e NAO pode derrubar quem esta em campo.
        if (event === 'SIGNED_OUT') cb(null);
        else if (session) cb(toSession(session));
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw wrap(error);
      const s = toSession(data.session);
      if (!s) throw new AuthApiError('desconhecido', 'login sem sessao');
      return s;
    },
    async signUp(email, password, fullName) {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw wrap(error);
      // Com "Confirm email" ligado, e-mail ja cadastrado volta como um usuario "de mentira" sem identidades.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new AuthApiError('user_already_exists', 'User already registered');
      }
      return toSession(data.session);
    },
    async signOut() {
      try {
        await client.auth.signOut();
      } catch {
        // sem internet: nao da para avisar o servidor, mas sair neste aparelho funciona do mesmo jeito
      }
      // O supabase-js nao apaga a sessao local se o aviso ao servidor falhar: apagamos nos mesmos.
      try {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`${storageKey}-code-verifier`);
      } catch {
        // armazenamento indisponivel
      }
    },
    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw wrap(error);
    },
    async fetchProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, role, active, reviewed_at')
        .eq('id', userId)
        .retry(false) // sem internet o supabase-js tentaria de novo por varios segundos; o app tenta de novo quando a internet voltar
        .maybeSingle();
      if (error) throw wrap(error);
      if (!data) return null;
      const row = data as { id: string; full_name: string; role: string; active: boolean; reviewed_at: string | null };
      return {
        id: row.id,
        fullName: row.full_name,
        role: (ROLES as readonly string[]).includes(row.role) ? (row.role as Role) : 'tecnico',
        active: row.active === true,
        reviewed: row.reviewed_at !== null,
      };
    },
  };
}
