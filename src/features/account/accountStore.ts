import { useSyncExternalStore } from 'react';
import { SETTING_KEYS, getSetting, setSetting } from '../../db/db';
import {
  EMPTY_LIMITER,
  SERVER_LIMIT_WAIT_MS,
  countsAsAttempt,
  formatWait,
  isLocked,
  isServerLimit,
  lockFor,
  normalizeLimiter,
  recordFailure,
  recordSuccess,
  remainingMs,
  type LimiterState,
} from './attemptLimiter';
import { AuthApiError, translateAuthError, type AccountProfile, type AuthApi, type AuthSession } from './authApi';
import { setActingRole } from '../../lib/ownership';
import { applyIdentity } from './deviceOwner';
import { isSupabaseConfigured, loadAuthApi } from './supabaseClient';

// Estado da conta neste aparelho. Regras de ouro: (1) o app nunca depende de conta para funcionar em campo;
// (2) sem internet, vale o ultimo estado conhecido; (3) sair da conta NAO apaga nenhum dado do aparelho.

export type AccountStatus =
  | 'sem-configuracao' // build sem as variaveis do Supabase: o app funciona normalmente, so sem conta
  | 'carregando'
  | 'deslogado'
  | 'verificando' // logado, mas ainda sem saber se foi aprovado (ex.: sem internet na primeira vez)
  | 'pendente' // pediu acesso; aguardando o administrador
  | 'desativado' // o administrador ja analisou e hoje o acesso esta inativo
  | 'ativo';

export interface AccountState {
  status: AccountStatus;
  email: string | null;
  profile: AccountProfile | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** Quando o perfil foi confirmado no servidor pela ultima vez (ms). */
  checkedAt: number | null;
  /** Este aparelho nunca teve uma conta: a tela de acesso abre em "Pedir acesso". */
  firstAccess: boolean;
  /** Ate quando entrar/pedir acesso esta travado neste aparelho (muitos erros seguidos); null = livre. */
  lockedUntil: number | null;
}

interface StoredIdentity {
  userId: string;
  email: string;
}

export interface AccountDeps {
  configured: boolean;
  loadApi(): Promise<AuthApi | null>;
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  isOnline(): boolean;
  now(): number;
  /** Chamado quando o perfil esta ativo (grava o nome do tecnico no aparelho). */
  onActive?(profile: AccountProfile): Promise<void>;
  /** Quem esta usando o aparelho mudou (id da conta, ou null ao sair). Define o dono dos novos registros. */
  onIdentity?(userId: string | null): Promise<void>;
  /** O perfil conhecido mudou (null = sem conta ou sem perfil). So um perfil ATIVO vale como papel. */
  onProfile?(profile: AccountProfile | null): void;
  /** Inscreve um aviso de "voltou a internet". Devolve como cancelar. */
  onOnline?(cb: () => void): () => void;
}

export const MIN_PASSWORD = 8;
const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isNetwork = (e: unknown) => e instanceof AuthApiError && e.code === 'network';

function statusOf(identity: StoredIdentity | null, profile: AccountProfile | null): AccountStatus {
  if (!identity) return 'deslogado';
  if (!profile) return 'verificando';
  if (profile.active) return 'ativo';
  return profile.reviewed ? 'desativado' : 'pendente';
}

export function createAccountStore(deps: AccountDeps) {
  let state: AccountState = {
    status: deps.configured ? 'carregando' : 'sem-configuracao',
    email: null,
    profile: null,
    busy: false,
    error: null,
    notice: null,
    checkedAt: null,
    firstAccess: true,
    lockedUntil: null,
  };
  const listeners = new Set<() => void>();
  let identity: StoredIdentity | null = null;
  let initPromise: Promise<void> | null = null;
  let signingOut = false;

  const set = (patch: Partial<AccountState>) => {
    const before = state.profile;
    state = { ...state, ...patch };
    if (state.profile !== before) deps.onProfile?.(state.profile);
    listeners.forEach((l) => l());
  };

  const showIdentity = (profile: AccountProfile | null) =>
    set({ status: statusOf(identity, profile), email: identity?.email ?? null, profile });

  // ---- limite de tentativas de acesso neste aparelho (ver attemptLimiter) ----
  let limiter: LimiterState = EMPTY_LIMITER;
  let limiterLoaded: Promise<void> | null = null;
  const lockedUntilOf = (l: LimiterState) => (isLocked(l, deps.now()) ? l.lockedUntil : null);
  const loadLimiter = () =>
    (limiterLoaded ??= deps.get<unknown>(SETTING_KEYS.authAttempts, null).then((raw) => {
      limiter = normalizeLimiter(raw);
      set({ lockedUntil: lockedUntilOf(limiter) });
    }));
  async function saveLimiter(next: LimiterState) {
    if (next === limiter) return;
    limiter = next;
    set({ lockedUntil: lockedUntilOf(next) });
    await deps.set(SETTING_KEYS.authAttempts, next);
  }
  /** Antes de tentar entrar/pedir acesso: devolve a mensagem de espera se o aparelho esta travado. */
  async function lockMessage(): Promise<string | null> {
    await loadLimiter();
    const wait = remainingMs(limiter, deps.now());
    return wait > 0 ? `Muitas tentativas. Tente de novo em ${formatWait(wait)}.` : null;
  }
  /** O servidor recusou a tentativa: conta o erro (ou espera, se ele mandou esperar). */
  async function registerFailure(err: unknown) {
    if (!(err instanceof AuthApiError) || !countsAsAttempt(err.code)) return;
    const now = deps.now();
    await saveLimiter(isServerLimit(err.code, err.status) ? lockFor(limiter, now, SERVER_LIMIT_WAIT_MS) : recordFailure(limiter, now));
  }

  async function saveIdentity(s: AuthSession) {
    const changedUser = identity !== null && identity.userId !== s.userId;
    identity = { userId: s.userId, email: s.email };
    await deps.set(SETTING_KEYS.account, identity);
    await deps.set(SETTING_KEYS.accountSeen, true);
    if (state.firstAccess) set({ firstAccess: false });
    await deps.onIdentity?.(s.userId);
    if (changedUser) await deps.set(SETTING_KEYS.accountProfile, null); // outra pessoa entrou: o perfil antigo nao vale
    showIdentity(changedUser ? null : state.profile?.id === s.userId ? state.profile : null);
  }

  async function clearIdentity() {
    identity = null;
    await deps.set(SETTING_KEYS.account, null);
    await deps.set(SETTING_KEYS.accountProfile, null);
    await deps.onIdentity?.(null);
    set({ status: 'deslogado', email: null, profile: null, checkedAt: null });
  }

  async function loadProfile(manual: boolean): Promise<boolean> {
    if (!identity) return false;
    if (!deps.isOnline()) {
      if (manual) set({ error: 'Sem internet para verificar agora. O último estado conhecido continua valendo.' });
      return false;
    }
    const api = await deps.loadApi();
    if (!api) return false;
    const userId = identity.userId;
    try {
      const profile = await api.fetchProfile(userId);
      if (!identity || identity.userId !== userId) return false; // saiu ou trocou de conta no meio
      if (!profile) {
        set({ error: manual ? 'Seu cadastro não foi encontrado no servidor. Fale com o administrador.' : state.error });
        return false;
      }
      const before = state.status;
      await deps.set(SETTING_KEYS.accountProfile, profile);
      set({
        status: statusOf(identity, profile),
        profile,
        checkedAt: deps.now(),
        error: null,
        notice: before === 'pendente' && profile.active ? 'Seu acesso foi aprovado! Bom trabalho.' : state.notice,
      });
      if (profile.active) await deps.onActive?.(profile);
      return true;
    } catch (e) {
      if (manual) set({ error: translateAuthError(e) });
      return false;
    }
  }

  /** Confirma a sessao (renova o token se preciso) e, havendo sessao, atualiza o perfil. Nunca desloga por falta de rede. */
  async function revalidate(known: StoredIdentity | null = identity): Promise<void> {
    const api = await deps.loadApi();
    if (!api) return;
    let session: AuthSession | null;
    try {
      session = await api.getSession();
    } catch (e) {
      // sem internet / demora: vale o que ja sabiamos
      session = isNetwork(e) ? known : null;
    }
    if (!session) {
      if (identity || known) await clearIdentity();
      else set({ status: 'deslogado' });
      return;
    }
    await saveIdentity(session);
    if (state.profile?.active) await deps.onActive?.(state.profile);
    void loadProfile(false);
  }

  async function guarded(task: () => Promise<boolean>): Promise<boolean> {
    if (state.busy) return false;
    set({ busy: true, error: null, notice: null });
    try {
      return await task();
    } finally {
      set({ busy: false });
    }
  }

  /** Se esta tentativa acabou de travar o aparelho, a mensagem diz por quanto tempo. */
  const withWait = (message: string) => {
    const wait = remainingMs(limiter, deps.now());
    if (wait <= 0) return message;
    // (a mensagem do servidor ja diz "Muitas tentativas": nao repete)
    return message.startsWith('Muitas tentativas') ? `Muitas tentativas. Tente de novo em ${formatWait(wait)}.` : `${message} Muitas tentativas: tente de novo em ${formatWait(wait)}.`;
  };

  const fail = (message: string) => {
    set({ error: message });
    return false;
  };

  return {
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    /** Id da conta logada (para a sincronizacao); null se ninguem entrou. */
    currentUserId: () => identity?.userId ?? null,

    init(): Promise<void> {
      initPromise ??= (async () => {
        if (!deps.configured) return;
        void loadLimiter();
        const cachedIdentity = await deps.get<StoredIdentity | null>(SETTING_KEYS.account, null);
        const seen = cachedIdentity !== null || (await deps.get<boolean>(SETTING_KEYS.accountSeen, false));
        set({ firstAccess: !seen });
        let cachedProfile = await deps.get<AccountProfile | null>(SETTING_KEYS.accountProfile, null);
        if (cachedIdentity && cachedProfile?.id !== cachedIdentity.userId) cachedProfile = null;
        await deps.onIdentity?.(cachedIdentity?.userId ?? null); // antes de qualquer registro novo
        if (cachedIdentity) {
          identity = cachedIdentity;
          showIdentity(cachedProfile); // ja mostra o ultimo estado conhecido, sem esperar rede
        }
        const api = await deps.loadApi();
        if (!api) return;

        // Os "ouvintes" entram ANTES de qualquer espera: a internet pode voltar enquanto a sessao e verificada.
        api.onChange((s) => {
          if (signingOut) return;
          if (!s) {
            if (identity) void clearIdentity();
          } else if (!identity || identity.userId !== s.userId) {
            void saveIdentity(s).then(() => loadProfile(false));
          }
        });
        deps.onOnline?.(() => void revalidate());

        if (!deps.isOnline() && cachedIdentity) {
          // Sem internet e ja sabemos quem e: nao ha o que perguntar (e o supabase-js demora ~25 s para desistir).
          if (state.profile?.active) await deps.onActive?.(state.profile);
          return;
        }
        await revalidate(cachedIdentity);
      })();
      return initPromise;
    },

    signIn(email: string, password: string): Promise<boolean> {
      const e = email.trim();
      if (!validEmail(e)) return Promise.resolve(fail('Digite um e-mail válido.'));
      if (!password) return Promise.resolve(fail('Digite a senha.'));
      if (!deps.isOnline()) return Promise.resolve(fail('Sem internet. Entrar precisa de conexão.'));
      return guarded(async () => {
        const locked = await lockMessage();
        if (locked) return fail(locked);
        try {
          const api = await deps.loadApi();
          if (!api) return fail('Este aplicativo não está ligado a um servidor.');
          await saveIdentity(await api.signIn(e, password));
          await saveLimiter(recordSuccess());
          await loadProfile(true);
          return true;
        } catch (err) {
          await registerFailure(err);
          return fail(withWait(translateAuthError(err)));
        }
      });
    },

    requestAccess(name: string, email: string, password: string): Promise<boolean> {
      const n = name.trim().replace(/\s+/g, ' ');
      const e = email.trim();
      if (n.length < 2) return Promise.resolve(fail('Digite seu nome completo.'));
      if (n.length > 100) return Promise.resolve(fail('O nome é muito longo (máximo de 100 letras).'));
      if (!validEmail(e)) return Promise.resolve(fail('Digite um e-mail válido.'));
      if (password.length < MIN_PASSWORD) return Promise.resolve(fail(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`));
      if (!deps.isOnline()) return Promise.resolve(fail('Sem internet. Pedir acesso precisa de conexão.'));
      return guarded(async () => {
        const locked = await lockMessage();
        if (locked) return fail(locked);
        try {
          const api = await deps.loadApi();
          if (!api) return fail('Este aplicativo não está ligado a um servidor.');
          const session = await api.signUp(e, password, n);
          await saveLimiter(recordSuccess());
          if (!session) {
            set({ notice: 'Pedido enviado. Confirme seu e-mail (se o administrador exigir) e depois use "Entrar".' });
            return true;
          }
          await saveIdentity(session);
          await loadProfile(true);
          set({ notice: 'Pedido enviado! Agora é só aguardar o administrador aprovar.' });
          return true;
        } catch (err) {
          await registerFailure(err);
          return fail(withWait(translateAuthError(err)));
        }
      });
    },

    /** Sai da conta neste aparelho. Os dados (atividades, elementos, fotos...) continuam intactos. */
    async signOut(): Promise<void> {
      signingOut = true;
      set({ busy: true, error: null, notice: null });
      try {
        const api = await deps.loadApi();
        await api?.signOut();
        await clearIdentity();
      } finally {
        signingOut = false;
        set({ busy: false });
      }
    },

    /** "Verificar agora": consulta o servidor para ver se o acesso mudou. */
    refreshProfile: () => guarded(() => loadProfile(true)),

    /** Mesma consulta, em silêncio (sem mostrar erro nem ocupar o botão): a tela "Aguardando aprovação" repete de tempos em tempos. */
    recheck: (): Promise<boolean> => (state.busy ? Promise.resolve(false) : loadProfile(false)),

    changePassword(password: string, confirm: string): Promise<boolean> {
      if (!identity) return Promise.resolve(fail('Entre na conta para trocar a senha.'));
      if (password.length < MIN_PASSWORD) return Promise.resolve(fail(`A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`));
      if (password !== confirm) return Promise.resolve(fail('As duas senhas digitadas são diferentes.'));
      if (!deps.isOnline()) return Promise.resolve(fail('Sem internet. Trocar a senha precisa de conexão.'));
      return guarded(async () => {
        try {
          const api = await deps.loadApi();
          if (!api) return fail('Este aplicativo não está ligado a um servidor.');
          await api.updatePassword(password);
          set({ notice: 'Senha alterada.' });
          return true;
        } catch (err) {
          return fail(translateAuthError(err));
        }
      });
    },

    dismissNotice: () => set({ notice: null, error: null }),
  };
}

export type AccountStore = ReturnType<typeof createAccountStore>;

export const accountStore: AccountStore = createAccountStore({
  configured: isSupabaseConfigured,
  loadApi: loadAuthApi,
  get: getSetting,
  set: setSetting,
  isOnline: () => navigator.onLine,
  now: () => Date.now(),
  onActive: (p) => setSetting(SETTING_KEYS.technician, p.fullName),
  onIdentity: (id) => applyIdentity(id),
  // so o perfil ATIVO vale como papel (o administrador desativado perde o poder de alterar na hora)
  onProfile: (p) => setActingRole(p?.active ? p.role : null),
  onOnline: (cb) => {
    window.addEventListener('online', cb);
    return () => window.removeEventListener('online', cb);
  },
});

export function useAccount<T>(selector: (s: AccountState) => T): T {
  return useSyncExternalStore(
    accountStore.subscribe,
    () => selector(accountStore.getState()),
    () => selector(accountStore.getState()),
  );
}
