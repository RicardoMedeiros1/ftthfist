import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthApiError, createSupabaseAuthApi, translateAuthError, type AuthApi } from './authApi';

// O supabase-js DE VERDADE conversando com um servidor falso (so o fetch e simulado): prova como a biblioteca
// devolve erros e sessoes, que e onde a gente mais erra quando imagina o formato.

const KEY = 'rotafibra-auth-test';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string, exp: number) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp, aud: 'authenticated' })}.sig`;
const user = (id: string, email: string) => ({ id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, identities: [{ id }], created_at: '2026-01-01T00:00:00Z' });
const sessionBody = (id: string, email: string, exp = Math.floor(Date.now() / 1000) + 3600) => ({
  access_token: jwt(id, exp), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `r-${id}`, user: user(id, email),
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let storage: Map<string, string>;
let offline = false;
let handler: (url: URL, init: RequestInit) => Response | Promise<Response>;
let requests: { url: string; method: string; body: unknown }[];

const fakeFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  requests.push({ url: url.pathname + url.search, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
  if (offline) throw new TypeError('Failed to fetch');
  return handler(url, init);
};

function makeApi(sessionTimeoutMs?: number): AuthApi {
  const client = createClient('https://fake.supabase.test', 'sb_publishable_test', {
    // (no navegador o supabase-js usa o localStorage sozinho; no Node, nao: entregamos o nosso para o teste enxergar a sessao)
    auth: {
      persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: KEY,
      storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) },
    },
    global: { fetch: fakeFetch as typeof fetch },
  });
  return createSupabaseAuthApi(client, KEY, { sessionTimeoutMs });
}

beforeEach(() => {
  storage = new Map();
  offline = false;
  requests = [];
  handler = () => json(500, {});
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe('entrar', () => {
  it('login certo devolve a sessao (id e e-mail)', async () => {
    handler = (url) => (url.pathname === '/auth/v1/token' ? json(200, sessionBody('u1', 'ana@x.com')) : json(404, {}));
    const s = await makeApi().signIn('ana@x.com', 'senha1234');
    expect(s).toEqual({ userId: 'u1', email: 'ana@x.com' });
    expect(requests[0]).toMatchObject({ method: 'POST', body: { email: 'ana@x.com', password: 'senha1234' } });
  });

  it('senha errada chega como invalid_credentials e vira mensagem em portugues', async () => {
    handler = () => json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    const err = await makeApi().signIn('ana@x.com', 'errada').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthApiError);
    expect((err as AuthApiError).code).toBe('invalid_credentials');
    expect(translateAuthError(err)).toBe('E-mail ou senha incorretos.');
  });

  it('sem internet: erro de REDE (nao "senha errada")', async () => {
    offline = true;
    const err = await makeApi().signIn('ana@x.com', 'x').catch((e: unknown) => e);
    expect((err as AuthApiError).code).toBe('network');
    expect(translateAuthError(err)).toMatch(/Sem conexão/);
  });

  it('limite de tentativas (429)', async () => {
    handler = () => json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' });
    const err = await makeApi().signIn('a@b.com', 'x').catch((e: unknown) => e);
    expect(translateAuthError(err)).toMatch(/Muitas tentativas/);
  });
});

describe('pedir acesso (signUp)', () => {
  it('envia o nome nos metadados e devolve a sessao quando o e-mail nao precisa de confirmacao', async () => {
    handler = () => json(200, sessionBody('u2', 'novo@x.com'));
    const s = await makeApi().signUp('novo@x.com', 'senha1234', 'Novo Tecnico');
    expect(s).toEqual({ userId: 'u2', email: 'novo@x.com' });
    expect(requests[0]!.body).toMatchObject({ email: 'novo@x.com', data: { full_name: 'Novo Tecnico' } });
  });

  it('projeto com confirmacao de e-mail: sem sessao (null)', async () => {
    handler = () => json(200, user('u3', 'novo@x.com'));
    expect(await makeApi().signUp('novo@x.com', 'senha1234', 'Novo')).toBeNull();
  });

  it('e-mail ja cadastrado com confirmacao ligada (usuario sem identidades) vira "ja existe"', async () => {
    handler = () => json(200, { ...user('u4', 'ana@x.com'), identities: [] });
    const err = await makeApi().signUp('ana@x.com', 'senha1234', 'Ana').catch((e: unknown) => e);
    expect((err as AuthApiError).code).toBe('user_already_exists');
    expect(translateAuthError(err)).toMatch(/Use "Entrar"/);
  });

  it('senha fraca recusada pelo servidor', async () => {
    handler = () => json(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 8 characters.' });
    const err = await makeApi().signUp('a@b.com', '123', 'A').catch((e: unknown) => e);
    expect(translateAuthError(err)).toMatch(/Senha fraca/);
  });
});

describe('sessao guardada e SEM INTERNET', () => {
  const seed = (exp: number) => storage.set(KEY, JSON.stringify(sessionBody('u1', 'ana@x.com', exp)));

  it('token valido: getSession devolve a sessao sem chamar a rede', async () => {
    seed(Math.floor(Date.now() / 1000) + 3600);
    offline = true;
    expect(await makeApi().getSession()).toEqual({ userId: 'u1', email: 'ana@x.com' });
    expect(requests).toHaveLength(0);
  });

  it('token VENCIDO e sem internet: erro de rede RAPIDO (o supabase-js sozinho levaria ~25 s) e nao "deslogado"', async () => {
    seed(Math.floor(Date.now() / 1000) - 7200);
    offline = true;
    const t0 = Date.now();
    const err = await makeApi(150).getSession().catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(err).toBeInstanceOf(AuthApiError);
    expect((err as AuthApiError).code).toBe('network');
    expect(storage.has(KEY)).toBe(true); // a sessao continua guardada para quando a internet voltar
  });

  it('token vencido e COM internet: renova e devolve a sessao', async () => {
    seed(Math.floor(Date.now() / 1000) - 7200);
    handler = (url) => (url.pathname === '/auth/v1/token' ? json(200, sessionBody('u1', 'ana@x.com')) : json(404, {}));
    expect(await makeApi().getSession()).toEqual({ userId: 'u1', email: 'ana@x.com' });
  });

  it('sem sessao nenhuma: null', async () => {
    expect(await makeApi().getSession()).toBeNull();
  });
});

describe('eventos do supabase-js', () => {
  // cliente de mentira so para disparar eventos na mao
  const withEvents = () => {
    let handler: ((event: string, session: unknown) => void) | undefined;
    const fake = {
      auth: {
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          handler = cb;
          return { data: { subscription: { unsubscribe: () => (handler = undefined) } } };
        },
      },
    };
    const seen: unknown[] = [];
    const api = createSupabaseAuthApi(fake as never, KEY);
    const off = api.onChange((s) => seen.push(s));
    return { emit: (e: string, s: unknown) => handler?.(e, s), seen, off, active: () => handler !== undefined };
  };
  const sess = { user: { id: 'u1', email: 'ana@x.com' } };

  it('SIGNED_OUT vira logout; entrada e renovacao de token viram sessao', () => {
    const t = withEvents();
    t.emit('SIGNED_IN', sess);
    t.emit('TOKEN_REFRESHED', sess);
    t.emit('SIGNED_OUT', null);
    expect(t.seen).toEqual([{ userId: 'u1', email: 'ana@x.com' }, { userId: 'u1', email: 'ana@x.com' }, null]);
  });

  it('INITIAL_SESSION SEM sessao (token vencido e sem internet) NAO derruba quem esta em campo', () => {
    const t = withEvents();
    t.emit('INITIAL_SESSION', null);
    t.emit('TOKEN_REFRESHED', null);
    expect(t.seen).toEqual([]);
    t.emit('INITIAL_SESSION', sess);
    expect(t.seen).toEqual([{ userId: 'u1', email: 'ana@x.com' }]);
  });

  it('cancelar a inscricao funciona', () => {
    const t = withEvents();
    t.off();
    expect(t.active()).toBe(false);
  });
});

describe('sair', () => {
  it('apaga a sessao guardada MESMO sem internet (o supabase-js sozinho nao apaga)', async () => {
    storage.set(KEY, JSON.stringify(sessionBody('u1', 'ana@x.com')));
    offline = true;
    await makeApi().signOut();
    expect(storage.has(KEY)).toBe(false);
  });
});

describe('perfil e senha', () => {
  it('le o proprio perfil (colunas e formatos) e traduz o papel', async () => {
    handler = (url) =>
      url.pathname === '/rest/v1/profiles'
        ? json(200, [{ id: 'u1', full_name: 'Ana Souza', role: 'escritorio', active: true, reviewed_at: '2026-10-06T12:00:00Z' }])
        : json(404, {});
    storage.set(KEY, JSON.stringify(sessionBody('u1', 'ana@x.com')));
    const p = await makeApi().fetchProfile('u1');
    expect(p).toEqual({ id: 'u1', fullName: 'Ana Souza', role: 'escritorio', active: true, reviewed: true });
    expect(requests[0]!.url).toContain('id=eq.u1');
    expect(requests[0]!.url).toContain('select=id');
  });

  it('pendente: active falso e reviewed falso; papel desconhecido vira tecnico; perfil ausente vira null', async () => {
    storage.set(KEY, JSON.stringify(sessionBody('u1', 'ana@x.com')));
    handler = () => json(200, [{ id: 'u1', full_name: 'Ana', role: 'superuser', active: false, reviewed_at: null }]);
    expect(await makeApi().fetchProfile('u1')).toEqual({ id: 'u1', fullName: 'Ana', role: 'tecnico', active: false, reviewed: false });
    handler = () => json(200, []);
    expect(await makeApi().fetchProfile('u1')).toBeNull();
  });

  it('falha de rede ao ler o perfil vira erro de rede', async () => {
    storage.set(KEY, JSON.stringify(sessionBody('u1', 'ana@x.com')));
    offline = true;
    const err = await makeApi().fetchProfile('u1').catch((e: unknown) => e);
    expect((err as AuthApiError).code).toBe('network');
  });

  it('trocar a senha: manda a nova e traduz "igual a atual"', async () => {
    storage.set(KEY, JSON.stringify(sessionBody('u1', 'ana@x.com')));
    handler = (url, init) =>
      url.pathname === '/auth/v1/user' && init.method === 'PUT'
        ? json(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' })
        : json(404, {});
    const err = await makeApi().updatePassword('senha1234').catch((e: unknown) => e);
    expect(requests.find((r) => r.method === 'PUT')!.body).toMatchObject({ password: 'senha1234' });
    expect(translateAuthError(err)).toBe('A nova senha precisa ser diferente da atual.');
  });
});
