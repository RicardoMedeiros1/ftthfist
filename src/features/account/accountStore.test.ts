import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB, SETTING_KEYS } from '../../db/db';
import { createAccountStore, type AccountDeps } from './accountStore';
import { AuthApiError, type AccountProfile, type AuthApi, type AuthSession } from './authApi';

// Servidor de autenticacao falso, em memoria.
class FakeApi implements AuthApi {
  users = new Map<string, { id: string; password: string; email: string }>();
  profiles = new Map<string, AccountProfile>();
  session: AuthSession | null = null;
  calls: string[] = [];
  confirmEmail = false; // projeto com "Confirm email" ligado: o cadastro nao devolve sessao
  sessionError: AuthApiError | null = null;
  profileError: AuthApiError | null = null;
  signInError: AuthApiError | null = null;
  private listeners = new Set<(s: AuthSession | null) => void>();

  addUser(email: string, password: string, profile: Partial<AccountProfile> = {}) {
    const id = `u-${this.users.size + 1}`;
    this.users.set(email, { id, password, email });
    this.profiles.set(id, { id, fullName: email.split('@')[0]!, role: 'tecnico', active: false, reviewed: false, ...profile });
    return id;
  }
  async getSession() {
    this.calls.push('getSession');
    if (this.sessionError) throw this.sessionError;
    return this.session;
  }
  onChange(cb: (s: AuthSession | null) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(s: AuthSession | null) {
    this.listeners.forEach((l) => l(s));
  }
  async signIn(email: string, password: string) {
    this.calls.push('signIn');
    if (this.signInError) throw this.signInError;
    const u = this.users.get(email);
    if (!u || u.password !== password) throw new AuthApiError('invalid_credentials', 'Invalid login credentials', 400);
    this.session = { userId: u.id, email };
    return this.session;
  }
  async signUp(email: string, password: string, fullName: string) {
    this.calls.push('signUp');
    if (this.users.has(email)) throw new AuthApiError('user_already_exists', 'User already registered', 422);
    if (password.length < 8) throw new AuthApiError('weak_password', 'Password should be at least 8 characters', 422);
    const id = this.addUser(email, password);
    this.profiles.set(id, { ...this.profiles.get(id)!, fullName });
    if (this.confirmEmail) return null;
    this.session = { userId: id, email };
    return this.session;
  }
  async signOut() {
    this.calls.push('signOut');
    this.session = null;
  }
  async updatePassword(password: string) {
    this.calls.push('updatePassword');
    const u = [...this.users.values()].find((x) => x.id === this.session?.userId);
    if (!u) throw new AuthApiError('session_not_found', 'x');
    if (u.password === password) throw new AuthApiError('same_password', 'New password should be different');
    u.password = password;
  }
  async fetchProfile(userId: string) {
    this.calls.push('fetchProfile');
    if (this.profileError) throw this.profileError;
    return this.profiles.get(userId) ?? null;
  }
}

let db: RotaFibraDB;
let api: FakeApi;
let online = true;
let loaded = true;
let onOnlineCb: (() => void) | null = null;

const make = (over: Partial<AccountDeps> = {}) =>
  createAccountStore({
    configured: true,
    loadApi: async () => (loaded ? api : null),
    get: async (k, fallback) => {
      const e = await db.settings.get(k);
      return e ? (e.value as never) : fallback;
    },
    set: async (k, v) => void (await db.settings.put({ key: k, value: v })),
    isOnline: () => online,
    now: () => 1_000,
    onActive: async (p) => void (await db.settings.put({ key: SETTING_KEYS.technician, value: p.fullName })),
    onOnline: (cb) => {
      onOnlineCb = cb;
      return () => undefined;
    },
    ...over,
  });
const tech = async () => (await db.settings.get(SETTING_KEYS.technician))?.value;

beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  api = new FakeApi();
  online = true;
  loaded = true;
  onOnlineCb = null;
});

describe('sem configuracao', () => {
  it('o app funciona normalmente: status "sem-configuracao" e nada e carregado', async () => {
    let called = false;
    const s = make({ configured: false, loadApi: async () => { called = true; return api; } });
    await s.init();
    expect(s.getState().status).toBe('sem-configuracao');
    expect(called).toBe(false);
  });
});

describe('abrir o app', () => {
  it('sem sessao: deslogado', async () => {
    const s = make();
    expect(s.getState().status).toBe('carregando');
    await s.init();
    expect(s.getState().status).toBe('deslogado');
  });

  it('com sessao e perfil ativo: ativo, e o nome do tecnico passa a ser o do cadastro', async () => {
    const id = api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true, fullName: 'Ana Souza' });
    api.session = { userId: id, email: 'ana@x.com' };
    const s = make();
    await s.init();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.getState()).toMatchObject({ status: 'ativo', email: 'ana@x.com', checkedAt: 1000 });
    expect(await tech()).toBe('Ana Souza');
    expect(s.currentUserId()).toBe(id);
  });

  it('SEM INTERNET: usa o ultimo estado conhecido, sem chamar o servidor e sem deslogar', async () => {
    const id = api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    api.session = { userId: id, email: 'ana@x.com' };
    await make().init();
    await new Promise((r) => setTimeout(r, 10));
    online = false;
    api.sessionError = new AuthApiError('network', 'Failed to fetch'); // token vencido e sem rede: supabase-js erra
    api.calls = [];
    const s = make();
    await s.init();
    expect(s.getState()).toMatchObject({ status: 'ativo', email: 'ana@x.com' });
    expect(api.calls).not.toContain('fetchProfile');
    expect(api.calls).not.toContain('getSession'); // offline e ja sabemos quem e: nao ha o que perguntar
  });

  it('o estado conhecido aparece ANTES de o servidor responder (nao pisca "deslogado")', async () => {
    const id = api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    api.session = { userId: id, email: 'ana@x.com' };
    await make().init();
    await new Promise((r) => setTimeout(r, 10));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = make({ loadApi: async () => { await gate; return api; } });
    const started = s.init();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.getState().status).toBe('ativo');
    release();
    await started;
  });

  it('sessao invalida de verdade (nao e problema de rede): limpa tudo e fica deslogado', async () => {
    const id = api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    api.session = { userId: id, email: 'ana@x.com' };
    await make().init();
    await new Promise((r) => setTimeout(r, 10));
    api.session = null;
    const s = make();
    await s.init();
    expect(s.getState()).toMatchObject({ status: 'deslogado', email: null, profile: null });
    expect((await db.settings.get(SETTING_KEYS.account))?.value).toBeNull();
  });

  it('logado mas sem perfil conhecido e sem internet: "verificando"', async () => {
    const id = api.addUser('nova@x.com', 'senha1234');
    api.session = { userId: id, email: 'nova@x.com' };
    online = false;
    const s = make();
    await s.init();
    expect(s.getState().status).toBe('verificando');
  });

  it('a internet voltar revalida a sessao e confirma o perfil sozinha', async () => {
    const id = api.addUser('nova@x.com', 'senha1234');
    api.session = { userId: id, email: 'nova@x.com' };
    online = false;
    const s = make();
    await s.init();
    online = true;
    onOnlineCb!();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.getState().status).toBe('pendente');
    expect(api.calls).toContain('getSession');
  });

  it('a internet volta e a sessao foi revogada no servidor: ai sim desloga', async () => {
    const id = api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    api.session = { userId: id, email: 'ana@x.com' };
    await make().init();
    await new Promise((r) => setTimeout(r, 10));
    online = false;
    const s = make();
    await s.init();
    expect(s.getState().status).toBe('ativo');
    api.session = null;
    online = true;
    onOnlineCb!();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.getState().status).toBe('deslogado');
  });

  it('a internet volta mas o servidor demora (rede): continua com o que sabia', async () => {
    const id = api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    api.session = { userId: id, email: 'ana@x.com' };
    await make().init();
    await new Promise((r) => setTimeout(r, 10));
    online = false;
    const s = make();
    await s.init();
    api.sessionError = new AuthApiError('network', 'tempo esgotado');
    online = true;
    onOnlineCb!();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.getState().status).toBe('ativo');
  });
});

describe('entrar', () => {
  it('valida antes de chamar o servidor', async () => {
    const s = make();
    await s.init();
    expect(await s.signIn('sem-arroba', 'x')).toBe(false);
    expect(s.getState().error).toMatch(/e-mail válido/);
    expect(await s.signIn('a@b.com', '')).toBe(false);
    expect(s.getState().error).toMatch(/senha/);
    expect(api.calls).not.toContain('signIn');
  });

  it('sem internet nao tenta e explica', async () => {
    const s = make();
    await s.init();
    online = false;
    expect(await s.signIn('a@b.com', 'x')).toBe(false);
    expect(s.getState().error).toMatch(/Sem internet/);
    expect(api.calls).not.toContain('signIn');
  });

  it('senha errada: mensagem em portugues, continua deslogado', async () => {
    api.addUser('ana@x.com', 'senha1234');
    const s = make();
    await s.init();
    expect(await s.signIn('ana@x.com', 'errada')).toBe(false);
    expect(s.getState()).toMatchObject({ status: 'deslogado', error: 'E-mail ou senha incorretos.' });
  });

  it('pendente entra e ve "pendente"; o e-mail aceita espacos e maiusculas digitadas', async () => {
    api.addUser('ana@x.com', 'senha1234');
    const s = make();
    await s.init();
    expect(await s.signIn('  ana@x.com ', 'senha1234')).toBe(true);
    expect(s.getState()).toMatchObject({ status: 'pendente', email: 'ana@x.com', error: null });
    expect(await tech()).toBeUndefined(); // o nome do tecnico so muda depois de aprovado
  });

  it('aprovado entra direto como ativo', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true, fullName: 'Ana Souza' });
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    expect(s.getState().status).toBe('ativo');
    expect(await tech()).toBe('Ana Souza');
  });

  it('desativado entra e ve "desativado"', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: false, reviewed: true });
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    expect(s.getState().status).toBe('desativado');
  });

  it('nao deixa enviar duas vezes ao mesmo tempo (toque duplo)', async () => {
    api.addUser('ana@x.com', 'senha1234');
    const s = make();
    await s.init();
    const [a, b] = await Promise.all([s.signIn('ana@x.com', 'senha1234'), s.signIn('ana@x.com', 'senha1234')]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(api.calls.filter((c) => c === 'signIn')).toHaveLength(1);
  });

  it('falha de rede no meio do login: mensagem de conexao', async () => {
    api.addUser('ana@x.com', 'senha1234');
    api.signIn = async () => { throw new AuthApiError('network', 'Failed to fetch'); };
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    expect(s.getState().error).toMatch(/Sem conexão/);
  });
});

describe('pedir acesso', () => {
  it('cria o pedido, entra e fica PENDENTE, com o nome pedido', async () => {
    const s = make();
    await s.init();
    expect(await s.requestAccess('  Joao   da  Silva ', 'joao@x.com', 'senha1234')).toBe(true);
    expect(s.getState()).toMatchObject({ status: 'pendente', email: 'joao@x.com' });
    expect(s.getState().notice).toMatch(/aguardar o administrador/);
    expect(api.profiles.get('u-1')!.fullName).toBe('Joao da Silva'); // espacos normalizados
    expect(await tech()).toBeUndefined();
  });

  it('valida nome, e-mail e senha minima ANTES de chamar o servidor', async () => {
    const s = make();
    await s.init();
    expect(await s.requestAccess('A', 'a@b.com', 'senha1234')).toBe(false);
    expect(s.getState().error).toMatch(/nome/);
    expect(await s.requestAccess('x'.repeat(101), 'a@b.com', 'senha1234')).toBe(false);
    expect(await s.requestAccess('Ana', 'a@b', 'senha1234')).toBe(false);
    expect(await s.requestAccess('Ana', 'a@b.com', '1234567')).toBe(false);
    expect(s.getState().error).toMatch(/pelo menos 8/);
    expect(api.calls).not.toContain('signUp');
  });

  it('e-mail que ja tem cadastro: orienta a usar Entrar', async () => {
    api.addUser('ana@x.com', 'senha1234');
    const s = make();
    await s.init();
    expect(await s.requestAccess('Ana', 'ana@x.com', 'outrasenha1')).toBe(false);
    expect(s.getState().error).toMatch(/Use "Entrar"/);
  });

  it('projeto que exige confirmar e-mail: pedido enviado, continua deslogado, com orientacao', async () => {
    api.confirmEmail = true;
    const s = make();
    await s.init();
    expect(await s.requestAccess('Ana', 'ana@x.com', 'senha1234')).toBe(true);
    expect(s.getState().status).toBe('deslogado');
    expect(s.getState().notice).toMatch(/Confirme seu e-mail/);
  });

  it('sem internet: explica e nao tenta', async () => {
    const s = make();
    await s.init();
    online = false;
    expect(await s.requestAccess('Ana', 'ana@x.com', 'senha1234')).toBe(false);
    expect(s.getState().error).toMatch(/Sem internet/);
  });
});

describe('verificar aprovacao', () => {
  it('pendente → ativo: avisa "aprovado" e passa a usar o nome do cadastro', async () => {
    const s = make();
    await s.init();
    await s.requestAccess('Ana Souza', 'ana@x.com', 'senha1234');
    expect(s.getState().status).toBe('pendente');
    api.profiles.set('u-1', { ...api.profiles.get('u-1')!, active: true, reviewed: true });
    expect(await s.refreshProfile()).toBe(true);
    expect(s.getState()).toMatchObject({ status: 'ativo' });
    expect(s.getState().notice).toMatch(/aprovado/);
    expect(await tech()).toBe('Ana Souza');
  });

  it('ativo → desativado quando o admin desativa', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    api.profiles.set('u-1', { ...api.profiles.get('u-1')!, active: false });
    await s.refreshProfile();
    expect(s.getState().status).toBe('desativado');
  });

  it('sem internet: avisa, mas mantem o ultimo estado', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    online = false;
    expect(await s.refreshProfile()).toBe(false);
    expect(s.getState()).toMatchObject({ status: 'ativo' });
    expect(s.getState().error).toMatch(/Sem internet/);
  });

  it('erro do servidor ao verificar: mensagem e estado mantido', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    api.profileError = new AuthApiError('PGRST', 'boom', 503);
    await s.refreshProfile();
    expect(s.getState().status).toBe('ativo');
    expect(s.getState().error).toMatch(/servidor/);
  });
});

describe('sair e trocar de conta', () => {
  it('sair limpa a conta mas NAO apaga nenhum dado do aparelho', async () => {
    await db.activities.add({ id: 'a1', createdAt: 1, updatedAt: 1, createdBy: 'x', deleted: false, syncStatus: 'pending', kind: 'implantacao', title: 'Rua A', technician: 'x', startedAt: 1, status: 'aberta', description: '', materials: [] });
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    await s.signOut();
    expect(s.getState()).toMatchObject({ status: 'deslogado', email: null, profile: null });
    expect(await db.activities.count()).toBe(1);
    expect((await db.settings.get(SETTING_KEYS.account))?.value).toBeNull();
    expect((await db.settings.get(SETTING_KEYS.accountProfile))?.value).toBeNull();
    expect(api.calls).toContain('signOut');
  });

  it('o evento de "saiu" do supabase-js (sessao revogada) tambem desloga', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    api.emit(null);
    await new Promise((r) => setTimeout(r, 10));
    expect(s.getState().status).toBe('deslogado');
  });

  it('outra pessoa entra no mesmo aparelho: o perfil da anterior nao vaza', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true, fullName: 'Ana' });
    api.addUser('bia@x.com', 'senha1234'); // pendente
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    expect(s.getState().profile?.fullName).toBe('Ana');
    await s.signOut();
    await s.signIn('bia@x.com', 'senha1234');
    expect(s.getState()).toMatchObject({ status: 'pendente', email: 'bia@x.com' });
    expect(s.getState().profile?.fullName).not.toBe('Ana');
  });
});

describe('trocar a senha', () => {
  it('valida, troca e avisa', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    expect(await s.changePassword('curta', 'curta')).toBe(false);
    expect(await s.changePassword('novasenha99', 'diferente99')).toBe(false);
    expect(s.getState().error).toMatch(/diferentes/);
    expect(await s.changePassword('senha1234', 'senha1234')).toBe(false);
    expect(s.getState().error).toMatch(/diferente da atual/);
    expect(await s.changePassword('novasenha99', 'novasenha99')).toBe(true);
    expect(s.getState().notice).toBe('Senha alterada.');
    expect(api.users.get('ana@x.com')!.password).toBe('novasenha99');
  });

  it('exige estar logado e ter internet', async () => {
    const s = make();
    await s.init();
    expect(await s.changePassword('novasenha99', 'novasenha99')).toBe(false);
    expect(s.getState().error).toMatch(/Entre na conta/);
  });
});

describe('quem esta agindo (dono dos novos registros)', () => {
  const spy = () => {
    const calls: Array<string | null> = [];
    return { calls, onIdentity: async (id: string | null) => void calls.push(id) };
  };

  it('abrir o app sem conta: avisa que ninguem entrou (antes de qualquer registro)', async () => {
    const { calls, onIdentity } = spy();
    await make({ onIdentity }).init();
    expect(calls).toEqual([null]);
  });

  it('abrir o app SEM internet com conta conhecida: ja sabe quem age, sem esperar o servidor', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    await make().init();
    await make().signIn('ana@x.com', 'senha1234');
    // reabre sem rede
    online = false;
    loaded = false; // nem carrega o supabase-js: so o que esta guardado
    const { calls, onIdentity } = spy();
    await make({ onIdentity }).init();
    expect(calls[0]).toBe('u-1');
  });

  it('entrar, sair e entrar como outra pessoa', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    api.addUser('bia@x.com', 'senha1234', { active: true, reviewed: true });
    const { calls, onIdentity } = spy();
    const s = make({ onIdentity });
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    await s.signOut();
    await s.signIn('bia@x.com', 'senha1234');
    expect(calls).toEqual([null, 'u-1', null, 'u-2']);
  });

  it('sessao revogada no servidor: volta a "ninguem"', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    const { calls, onIdentity } = spy();
    const s = make({ onIdentity });
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    api.emit(null);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.at(-1)).toBeNull();
  });

  it('sem configuracao: nunca chama (o app sem conta segue como sempre)', async () => {
    const { calls, onIdentity } = spy();
    await make({ configured: false, onIdentity }).init();
    expect(calls).toEqual([]);
  });
});

describe('limite de tentativas de acesso neste aparelho', () => {
  let clock = 1_000;
  const MIN = 60_000;
  const limited = () => make({ now: () => clock });
  const wrong = (s: ReturnType<typeof make>) => s.signIn('ana@x.com', 'errada123');
  const signInCalls = () => api.calls.filter((c) => c === 'signIn').length;

  beforeEach(() => {
    clock = 1_000;
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
  });

  it('5 senhas erradas seguidas travam o aparelho por 5 minutos, e a 5ª já diz quanto esperar', async () => {
    const s = limited();
    await s.init();
    for (let i = 0; i < 4; i++) {
      await wrong(s);
      expect(s.getState().lockedUntil).toBeNull();
      expect(s.getState().error).toBe('E-mail ou senha incorretos.');
    }
    await wrong(s);
    expect(s.getState().lockedUntil).toBe(clock + 5 * MIN);
    expect(s.getState().error).toBe('E-mail ou senha incorretos. Muitas tentativas: tente de novo em 5:00.');
    expect(signInCalls()).toBe(5);
  });

  it('travado: nem chama o servidor, mesmo com a senha certa, e a espera diminui com o tempo', async () => {
    const s = limited();
    await s.init();
    for (let i = 0; i < 5; i++) await wrong(s);
    expect(await s.signIn('ana@x.com', 'senha1234')).toBe(false);
    expect(s.getState().error).toBe('Muitas tentativas. Tente de novo em 5:00.');
    clock += 90_000;
    await s.signIn('ana@x.com', 'senha1234');
    expect(s.getState().error).toBe('Muitas tentativas. Tente de novo em 3:30.');
    expect(signInCalls()).toBe(5); // nenhuma chamada a mais
    expect(s.getState().status).toBe('deslogado');
  });

  it('passada a espera dá para tentar de novo; acertar zera tudo', async () => {
    const s = limited();
    await s.init();
    for (let i = 0; i < 5; i++) await wrong(s);
    clock += 5 * MIN + 1;
    expect(await s.signIn('ana@x.com', 'senha1234')).toBe(true);
    expect(s.getState()).toMatchObject({ status: 'ativo', lockedUntil: null });
    const saved = (await db.settings.get(SETTING_KEYS.authAttempts))?.value as { fails: number; strikes: number; lockedUntil: number };
    expect(saved).toMatchObject({ fails: 0, strikes: 0, lockedUntil: 0 });
  });

  it('a trava vale depois de recarregar o app (fica salva no aparelho)', async () => {
    const first = limited();
    await first.init();
    for (let i = 0; i < 5; i++) await wrong(first);
    const second = limited(); // "recarregou a página"
    await second.init();
    expect(second.getState().lockedUntil).toBe(clock + 5 * MIN);
    expect(await second.signIn('ana@x.com', 'senha1234')).toBe(false);
    expect(second.getState().error).toContain('Tente de novo em 5:00');
  });

  it('a segunda trava é mais longa (15 minutos)', async () => {
    const s = limited();
    await s.init();
    for (let i = 0; i < 5; i++) await wrong(s);
    clock += 5 * MIN + 1;
    for (let i = 0; i < 5; i++) await wrong(s);
    expect(s.getState().lockedUntil).toBe(clock + 15 * MIN);
  });

  it('falta de rede, e-mail inválido e campo vazio NÃO contam como tentativa', async () => {
    const s = limited();
    await s.init();
    api.signInError = new AuthApiError('network', 'Failed to fetch');
    for (let i = 0; i < 6; i++) await wrong(s);
    for (let i = 0; i < 6; i++) await s.signIn('sem-arroba', 'x');
    for (let i = 0; i < 6; i++) await s.signIn('ana@x.com', '');
    expect(s.getState().lockedUntil).toBeNull();
    api.signInError = null;
    expect(await s.signIn('ana@x.com', 'senha1234')).toBe(true);
  });

  it('o servidor mandou esperar (429): espera 2 minutos sem contar como erro', async () => {
    const s = limited();
    await s.init();
    api.signInError = new AuthApiError('over_request_rate_limit', 'rate', 429);
    await wrong(s);
    expect(s.getState().lockedUntil).toBe(clock + 2 * MIN);
    expect(s.getState().error).toBe('Muitas tentativas. Tente de novo em 2:00.');
    const saved = (await db.settings.get(SETTING_KEYS.authAttempts))?.value as { fails: number; strikes: number };
    expect(saved).toMatchObject({ fails: 0, strikes: 0 });
  });

  it('pedir acesso também conta (e-mail já cadastrado), mas senha fraca não', async () => {
    const s = limited();
    await s.init();
    for (let i = 0; i < 6; i++) await s.requestAccess('Ana Souza', 'nova@x.com', 'a1b2c3d4'.slice(0, 8)); // 1º cria; os outros dão "já cadastrado"
    expect(s.getState().lockedUntil).not.toBeNull();
    const t = limited();
    clock += 10 * MIN;
    await t.init();
    api.signUp = async () => {
      throw new AuthApiError('weak_password', 'Password should be at least 8 characters', 422);
    };
    for (let i = 0; i < 8; i++) await t.requestAccess('Bia Souza', 'bia@x.com', '12345678');
    const saved = (await db.settings.get(SETTING_KEYS.authAttempts))?.value as { fails: number };
    expect(saved.fails).toBe(0);
  });
});

describe('primeiro acesso do aparelho', () => {
  it('aparelho novo: primeiro acesso; depois de ter uma conta deixa de ser, mesmo saindo e reabrindo', async () => {
    api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    const s = make();
    await s.init();
    expect(s.getState()).toMatchObject({ status: 'deslogado', firstAccess: true });
    await s.signIn('ana@x.com', 'senha1234');
    expect(s.getState().firstAccess).toBe(false);
    await s.signOut();
    const again = make(); // reabriu o app, ninguem logado
    await again.init();
    expect(again.getState()).toMatchObject({ status: 'deslogado', firstAccess: false });
  });

  it('pedir acesso sem confirmar e-mail ainda é primeiro acesso (nenhuma conta entrou)', async () => {
    api.confirmEmail = true;
    const s = make();
    await s.init();
    await s.requestAccess('Ana Souza', 'ana@x.com', 'senha1234');
    expect(s.getState()).toMatchObject({ status: 'deslogado', firstAccess: true });
  });

  it('quem já estava logado antes desta versão não é "primeiro acesso"', async () => {
    const id = api.addUser('ana@x.com', 'senha1234', { active: true, reviewed: true });
    api.session = { userId: id, email: 'ana@x.com' };
    await db.settings.put({ key: SETTING_KEYS.account, value: { userId: id, email: 'ana@x.com' } });
    const s = make();
    await s.init();
    expect(s.getState().firstAccess).toBe(false);
  });
});

describe('conferir a aprovação em silêncio', () => {
  it('pendente → ativo sem mostrar erro nem ocupar o botão; sem internet não faz nada', async () => {
    const id = api.addUser('ana@x.com', 'senha1234');
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    expect(s.getState().status).toBe('pendente');
    online = false;
    expect(await s.recheck()).toBe(false);
    expect(s.getState()).toMatchObject({ status: 'pendente', error: null, busy: false });
    online = true;
    api.profiles.set(id, { ...api.profiles.get(id)!, active: true, reviewed: true });
    expect(await s.recheck()).toBe(true);
    expect(s.getState()).toMatchObject({ status: 'ativo', error: null });
    expect(s.getState().notice).toBe('Seu acesso foi aprovado! Bom trabalho.');
  });

  it('erro do servidor na conferência silenciosa não vira mensagem na tela', async () => {
    api.addUser('ana@x.com', 'senha1234');
    const s = make();
    await s.init();
    await s.signIn('ana@x.com', 'senha1234');
    api.profileError = new AuthApiError('desconhecido', 'x', 500);
    expect(await s.recheck()).toBe(false);
    expect(s.getState().error).toBeNull();
    expect(s.getState().status).toBe('pendente');
  });
});
