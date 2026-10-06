import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '../../db/db';
import { setActingUser } from '../../lib/ownership';
import { photoRepo } from '../elements/photoRepo';
import { TOKEN_SKEW_MS, readAuthMirror, tokenUsable, writeAuthMirror, type AuthMirror } from './authMirror';
import { BUSY, runBackgroundSync, type BackgroundDeps, type Notice } from './background';
import { SyncHttpError } from './remote';
import { Device, fieldWork, pole } from './testDevice';
import { TestServer } from './testServer';

let server: TestServer;
let ana: Device;
let notices: Notice[];
let busy = false;
let clock = Date.now();

const mirror = (over: Partial<AuthMirror> = {}): AuthMirror => ({
  userId: 'ana', accessToken: 'token-de-acesso', expiresAt: Math.floor(clock / 1000) + 3600, url: 'https://x.supabase.co', key: 'sb_publishable_x', ...over,
});

beforeEach(async () => {
  server = new TestServer();
  server.addUser('ana');
  server.addUser('clara', 'escritorio');
  ana = await new Device(server.client('ana'), 'ana').open();
  notices = [];
  busy = false;
  clock = Date.now();
  await ana.db.settings.bulkPut([
    { key: SETTING_KEYS.account, value: { userId: 'ana', email: 'ana@x.com' } },
    { key: SETTING_KEYS.accountProfile, value: { id: 'ana', fullName: 'Ana', role: 'tecnico', active: true, reviewed: true } },
    { key: SETTING_KEYS.authMirror, value: mirror() },
  ]);
});
afterEach(() => setActingUser(null));

const deps = (over: Partial<BackgroundDeps> = {}): BackgroundDeps => ({
  db: ana.db,
  now: () => clock,
  makeRemote: () => server.client('ana'),
  exclusive: async (fn) => (busy ? BUSY : fn()),
  notify: async (n) => void notices.push(n),
  ...over,
});
const setMirror = (m: AuthMirror | null) => (m ? ana.db.settings.put({ key: SETTING_KEYS.authMirror, value: m }) : ana.db.settings.delete(SETTING_KEYS.authMirror));

describe('envio com o app fechado', () => {
  it('com pendências e token válido: envia tudo, sem baixar nada, e não incomoda ninguém', async () => {
    await fieldWork(ana, 'Ana');
    expect(await runBackgroundSync(deps())).toBe('enviado');
    expect([server.count('activities'), server.count('elements'), server.count('cables'), server.count('track_points')]).toEqual([1, 2, 1, 3]);
    expect(server.calls.some((c) => c.fn === 'pull')).toBe(false);
    expect(notices).toEqual([]);
    expect(await ana.counts()).toEqual({ pending: 0, blocked: 0 });
  });

  it('as fotos também sobem (arquivo e registro)', async () => {
    const { p1 } = await fieldWork(ana, 'Ana');
    const photo = await ana.as(() => photoRepo(ana.db).add(p1.id, { blob: new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }) }, 'Ana'));
    expect(await runBackgroundSync(deps())).toBe('enviado');
    expect(server.files.has(`ana/${photo.id}.jpg`)).toBe(true);
    expect(server.get('photos', photo.id)).toBeDefined();
  });

  it('sem nada pendente: não faz nem uma chamada ao servidor', async () => {
    await fieldWork(ana, 'Ana');
    await ana.sync();
    server.calls.length = 0;
    expect(await runBackgroundSync(deps())).toBe('nada');
    expect(server.calls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('sem conta neste aparelho, ou conta ainda não aprovada: não faz nada', async () => {
    await fieldWork(ana, 'Ana');
    await ana.db.settings.delete(SETTING_KEYS.account);
    expect(await runBackgroundSync(deps())).toBe('nada');
    await ana.db.settings.put({ key: SETTING_KEYS.account, value: { userId: 'ana', email: 'a@x.com' } });
    await ana.db.settings.put({ key: SETTING_KEYS.accountProfile, value: { id: 'ana', fullName: 'Ana', role: 'tecnico', active: false, reviewed: false } });
    expect(await runBackgroundSync(deps())).toBe('nada');
    expect(server.calls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('escritório não envia', async () => {
    await fieldWork(ana, 'Ana');
    await ana.db.settings.put({ key: SETTING_KEYS.accountProfile, value: { id: 'ana', fullName: 'Ana', role: 'escritorio', active: true, reviewed: true } });
    expect(await runBackgroundSync(deps())).toBe('nada');
    expect(server.calls).toEqual([]);
  });
});

describe('token vencido (o service worker NÃO renova a sessão)', () => {
  it('avisa por notificação quantos registros esperam e não chama o servidor', async () => {
    await fieldWork(ana, 'Ana');
    await setMirror(mirror({ expiresAt: Math.floor(clock / 1000) - 10 }));
    expect(await runBackgroundSync(deps())).toBe('avisou');
    expect(server.calls).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.body).toBe('7 registros aguardando envio. Abra o app para enviar.');
    expect(notices[0]!.tag).toBe('rotafibra-pendentes');
  });

  it('o aviso usa o singular com 1 registro', async () => {
    const { p1 } = await fieldWork(ana, 'Ana');
    await ana.sync();
    await ana.as(() => ana.els.update(p1.id, { code: 'X' }));
    await setMirror(null);
    await runBackgroundSync(deps());
    expect(notices[0]!.body).toBe('1 registro aguardando envio. Abra o app para enviar.');
  });

  it('um token que vence em menos de 1 minuto já não serve (não arrisca vencer no meio do envio)', async () => {
    await fieldWork(ana, 'Ana');
    await setMirror(mirror({ expiresAt: Math.floor((clock + TOKEN_SKEW_MS - 5000) / 1000) }));
    expect(await runBackgroundSync(deps())).toBe('avisou');
    expect(server.calls).toEqual([]);
  });

  it('sem cópia do token, ou token de outra pessoa: avisa e não envia', async () => {
    await fieldWork(ana, 'Ana');
    await setMirror(null);
    expect(await runBackgroundSync(deps())).toBe('avisou');
    await setMirror(mirror({ userId: 'bia' }));
    expect(await runBackgroundSync(deps())).toBe('avisou');
    expect(server.calls).toEqual([]);
  });

  it('o servidor responde "sessão inválida" no meio: avisa para abrir o app', async () => {
    await fieldWork(ana, 'Ana');
    server.failNext = new SyncHttpError('auth', 'JWT expired', 401, 'PGRST301');
    expect(await runBackgroundSync(deps())).toBe('avisou');
    expect(notices[0]!.tag).toBe('rotafibra-pendentes');
  });
});

describe('falhas e concorrência', () => {
  it('sem conexão: pede ao navegador para tentar de novo depois, em silêncio', async () => {
    await fieldWork(ana, 'Ana');
    server.down = true;
    expect(await runBackgroundSync(deps())).toBe('tentar-depois');
    expect(notices).toEqual([]);
    expect(await ana.counts()).toEqual({ pending: 7, blocked: 0 });
  });

  it('servidor fora do ar (503): tentar depois', async () => {
    await fieldWork(ana, 'Ana');
    server.failNext = new SyncHttpError('transient', 'Service Unavailable', 503, '');
    expect(await runBackgroundSync(deps())).toBe('tentar-depois');
  });

  it('o app já está sincronizando: não faz um segundo ciclo ao mesmo tempo', async () => {
    await fieldWork(ana, 'Ana');
    busy = true;
    expect(await runBackgroundSync(deps())).toBe('ocupado');
    expect(server.calls).toEqual([]);
  });

  it('registro recusado pelo servidor: o resto sobe e o técnico é avisado do recusado', async () => {
    await fieldWork(ana, 'Ana');
    const bad = await ana.as(() => ana.els.create(pole(9), 'Ana'));
    await ana.db.elements.update(bad.id, { lat: 999 });
    expect(await runBackgroundSync(deps())).toBe('avisou');
    expect(server.count('elements')).toBe(2);
    expect(notices.at(-1)).toMatchObject({ tag: 'rotafibra-recusados', body: '1 registro foi recusado pelo servidor. Abra o app e veja em Sincronização.' });
  });

  it('muitos recusados seguidos: para e avisa (provável problema de conta)', async () => {
    await fieldWork(ana, 'Ana');
    for (let i = 2; i < 12; i++) {
      const e = await ana.as(() => ana.els.create(pole(i), 'Ana'));
      await ana.db.elements.update(e.id, { lat: 999 });
    }
    expect(await runBackgroundSync(deps())).toBe('avisou');
    expect(notices.at(-1)!.tag).toBe('rotafibra-pendentes');
  });
});

describe('cópia do token', () => {
  const session = { access_token: 'a.b.c', expires_at: 2_000_000_000, user: { id: 'ana' }, refresh_token: 'NUNCA-GUARDAR' };

  it('guarda só o token de acesso, o prazo, o servidor e a chave pública (nunca o token de renovação)', async () => {
    await writeAuthMirror(ana.db, session, { url: 'https://x.supabase.co', key: 'sb_publishable_x' });
    const m = await readAuthMirror(ana.db);
    expect(m).toEqual({ userId: 'ana', accessToken: 'a.b.c', expiresAt: 2_000_000_000, url: 'https://x.supabase.co', key: 'sb_publishable_x' });
    expect(JSON.stringify(await ana.db.settings.toArray())).not.toContain('NUNCA-GUARDAR');
  });

  it('sair da conta (sem sessão) apaga a cópia', async () => {
    await writeAuthMirror(ana.db, session, { url: 'u', key: 'k' });
    await writeAuthMirror(ana.db, null, { url: 'u', key: 'k' });
    expect(await readAuthMirror(ana.db)).toBeNull();
  });

  it('fica fora do backup (é do aparelho)', async () => {
    const { DEVICE_SETTINGS } = await import('../export/backup');
    expect(DEVICE_SETTINGS.has(SETTING_KEYS.authMirror)).toBe(true);
  });

  it('tokenUsable: nulo, vencido, na folga, e válido', () => {
    const now = 1_000_000_000_000;
    expect(tokenUsable(null, now)).toBe(false);
    expect(tokenUsable(mirror({ expiresAt: now / 1000 - 1 }), now)).toBe(false);
    expect(tokenUsable(mirror({ expiresAt: now / 1000 + 59 }), now)).toBe(false);
    expect(tokenUsable(mirror({ expiresAt: now / 1000 + 61 }), now)).toBe(true);
  });
});
