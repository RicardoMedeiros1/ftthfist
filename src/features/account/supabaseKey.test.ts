import { describe, expect, it } from 'vitest';
import { classifyKey, describeConfig, readConfig } from './supabaseKey';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.assinatura`;

describe('classifyKey', () => {
  it('Publishable e anon sao publicas', () => {
    expect(classifyKey('sb_publishable_AbC123')).toBe('publica');
    expect(classifyKey(jwt('anon'))).toBe('publica');
  });
  it('Secret e service_role sao secretas, qualquer que seja o formato', () => {
    expect(classifyKey('sb_secret_AbC123')).toBe('secreta');
    expect(classifyKey('SB_SECRET_xyz')).toBe('secreta');
    expect(classifyKey(jwt('service_role'))).toBe('secreta');
    expect(classifyKey(jwt('supabase_admin'))).toBe('secreta'); // qualquer papel que nao seja anon
  });
  it('vazio ou lixo e invalida', () => {
    expect(classifyKey('')).toBe('invalida');
    expect(classifyKey(undefined)).toBe('invalida');
    expect(classifyKey('   ')).toBe('invalida');
    expect(classifyKey('abc')).toBe('invalida');
    expect(classifyKey('a.b.c')).toBe('invalida');
  });
});

describe('readConfig', () => {
  const ok = { VITE_SUPABASE_URL: 'https://abcd.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_x' };
  it('sem variaveis: o app funciona sem conta (null)', () => {
    expect(readConfig({})).toBeNull();
    expect(readConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' })).toBeNull();
  });
  it('configuracao valida, com espacos e barra final tolerados', () => {
    expect(readConfig(ok)).toEqual({ url: 'https://abcd.supabase.co', key: 'sb_publishable_x' });
    expect(readConfig({ VITE_SUPABASE_URL: '  https://abcd.supabase.co/ ', VITE_SUPABASE_ANON_KEY: ' sb_publishable_x ' })).toEqual({
      url: 'https://abcd.supabase.co',
      key: 'sb_publishable_x',
    });
  });
  it('chave SECRETA derruba o build/app com mensagem clara (nunca vai para o site)', () => {
    expect(() => readConfig({ ...ok, VITE_SUPABASE_ANON_KEY: 'sb_secret_x' })).toThrow(/SECRETA/);
    expect(() => readConfig({ ...ok, VITE_SUPABASE_ANON_KEY: jwt('service_role') })).toThrow(/SECRETA/);
    expect(() => readConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: 'sb_secret_x' })).toThrow(/SECRETA/);
  });
  it('URL ruim (sem https, com caminho) ou so metade configurada: trata como nao configurado', () => {
    expect(readConfig({ ...ok, VITE_SUPABASE_URL: 'http://abcd.supabase.co' })).toBeNull();
    expect(readConfig({ ...ok, VITE_SUPABASE_URL: 'abcd.supabase.co' })).toBeNull();
    expect(readConfig({ VITE_SUPABASE_URL: ok.VITE_SUPABASE_URL })).toBeNull();
    expect(readConfig({ VITE_SUPABASE_ANON_KEY: ok.VITE_SUPABASE_ANON_KEY })).toBeNull();
  });
});

describe('describeConfig (o motivo, em portugues, quando o login nao liga)', () => {
  const url = 'https://abcd.supabase.co';
  const pub = 'sb_publishable_x';
  it('cada caso aponta o que falta, sem mostrar valores', () => {
    expect(describeConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: pub }).status).toBe('ligado');
    expect(describeConfig({}).status).toBe('vazio');
    expect(describeConfig({ VITE_SUPABASE_ANON_KEY: pub })).toMatchObject({ status: 'so-chave', message: expect.stringContaining('VITE_SUPABASE_URL') });
    expect(describeConfig({ VITE_SUPABASE_URL: url }).status).toBe('so-url');
    expect(describeConfig({ VITE_SUPABASE_URL: 'abcd.supabase.co', VITE_SUPABASE_ANON_KEY: pub }).status).toBe('url-invalida');
    expect(describeConfig({ VITE_SUPABASE_URL: url + '/rest/v1', VITE_SUPABASE_ANON_KEY: pub }).status).toBe('url-invalida');
    expect(describeConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'lixo' }).status).toBe('chave-invalida');
    for (const m of [url, pub, 'lixo']) expect(describeConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'lixo' }).message).not.toContain(m);
  });
  it('chave secreta continua derrubando', () => {
    expect(() => describeConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_secret_x' })).toThrow(/SECRETA/);
  });
});
