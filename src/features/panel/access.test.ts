import { describe, expect, it } from 'vitest';
import type { AccountStatus } from '../account/accountStore';
import type { Role } from '../account/authApi';
import { ACCESS_TEXT, panelAccess } from './access';

describe('panelAccess', () => {
  it('escritorio e administrador ativos abrem o painel; tecnico nao', () => {
    expect(panelAccess('ativo', 'escritorio')).toBe('liberado');
    expect(panelAccess('ativo', 'admin')).toBe('liberado');
    expect(panelAccess('ativo', 'tecnico')).toBe('sem-permissao');
  });

  it('ativo sem papel conhecido nao abre (nunca libera por omissao)', () => {
    expect(panelAccess('ativo', undefined)).toBe('sem-permissao');
  });

  it('so um perfil ATIVO vale: pendente, desativado e verificando nao abrem, mesmo com papel de admin', () => {
    const role: Role = 'admin';
    for (const s of ['pendente', 'desativado', 'verificando', 'carregando'] as AccountStatus[]) expect(panelAccess(s, role), s).not.toBe('liberado');
    expect(panelAccess('desativado', role)).toBe('sem-permissao');
    for (const s of ['pendente', 'verificando', 'carregando'] as AccountStatus[]) expect(panelAccess(s, role), s).toBe('aguardando');
  });

  it('sem conta (deslogado ou app sem servidor) pede para entrar', () => {
    expect(panelAccess('deslogado', undefined)).toBe('sem-conta');
    expect(panelAccess('sem-configuracao', undefined)).toBe('sem-conta');
  });

  it('todo motivo de recusa tem um texto em portugues', () => {
    for (const k of ['sem-conta', 'aguardando', 'sem-permissao'] as const) expect(ACCESS_TEXT[k].length).toBeGreaterThan(10);
  });
});
