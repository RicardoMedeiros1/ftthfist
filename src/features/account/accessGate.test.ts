import { describe, expect, it } from 'vitest';
import { accessGateFor } from './accessGate';
import type { AccountStatus } from './accountStore';

describe('quem entra no app', () => {
  it('só o acesso aprovado (e o build sem servidor) abre o app', () => {
    expect(accessGateFor('ativo')).toBe('open');
    expect(accessGateFor('sem-configuracao')).toBe('open');
  });

  it('todos os outros estados ficam na tela de acesso, cada um com a sua tela', () => {
    const expected: Record<Exclude<AccountStatus, 'ativo' | 'sem-configuracao'>, string> = {
      carregando: 'loading',
      deslogado: 'login',
      verificando: 'checking',
      pendente: 'pending',
      desativado: 'disabled',
    };
    for (const [status, gate] of Object.entries(expected)) expect(accessGateFor(status as AccountStatus)).toBe(gate);
  });
});
