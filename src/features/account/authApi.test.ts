import { describe, expect, it } from 'vitest';
import { AuthApiError, translateAuthError } from './authApi';

describe('translateAuthError', () => {
  const t = (code: string, message = '', status?: number, name?: string) => translateAuthError({ code, message, status, name });
  it('credenciais, e-mail repetido, senha fraca e igual', () => {
    expect(t('invalid_credentials', 'Invalid login credentials', 400)).toBe('E-mail ou senha incorretos.');
    expect(t('', 'Invalid login credentials')).toBe('E-mail ou senha incorretos.');
    expect(t('user_already_exists')).toMatch(/Use "Entrar"/);
    expect(t('email_exists')).toMatch(/Use "Entrar"/);
    expect(t('', 'User already registered')).toMatch(/Use "Entrar"/);
    expect(t('weak_password', 'Password should be at least 8 characters')).toMatch(/Senha fraca/);
    expect(t('same_password')).toMatch(/diferente da atual/);
    expect(t('', 'New password should be different from the old password.')).toMatch(/diferente da atual/); // texto real do Supabase, sem codigo
  });
  it('limite de tentativas, cadastro fechado, e-mail invalido, sessao expirada', () => {
    expect(t('over_request_rate_limit', '', 429)).toMatch(/Muitas tentativas/);
    expect(t('', 'rate', 429)).toMatch(/Muitas tentativas/);
    expect(t('signup_disabled')).toMatch(/cadastro está fechado/);
    expect(t('email_address_invalid')).toMatch(/E-mail inválido/);
    expect(t('session_not_found')).toMatch(/sessão expirou/);
    expect(t('', 'jwt', 401)).toMatch(/sessão expirou/);
  });
  it('rede (varios formatos de navegador) e servidor com problema', () => {
    expect(translateAuthError(new AuthApiError('network', 'x'))).toMatch(/Sem conexão/);
    expect(t('', 'TypeError: Failed to fetch')).toMatch(/Sem conexão/);
    expect(t('', 'NetworkError when attempting to fetch resource.')).toMatch(/Sem conexão/);
    expect(t('', 'Load failed')).toMatch(/Sem conexão/);
    expect(t('', '', 0, 'AuthRetryableFetchError')).toMatch(/Sem conexão/);
    expect(t('', 'boom', 503)).toMatch(/servidor está com problema/);
  });
  it('qualquer outra coisa: mensagem generica, sem vazar texto tecnico', () => {
    const msg = translateAuthError(new Error('relation "x" does not exist'));
    expect(msg).toBe('Não foi possível concluir. Tente de novo.');
    expect(translateAuthError(null)).toBe('Não foi possível concluir. Tente de novo.');
  });
});
