import { describe, expect, it } from 'vitest';
import { AdminError, type Person } from './adminApi';
import { adminErrorText, confirmText, groupOf, groupPeople, patchFor } from './people';

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p', email: 'a@x.com', fullName: 'Ana', role: 'tecnico', active: true, createdAt: '2026-10-01T10:00:00Z', reviewedAt: '2026-10-02T10:00:00Z', reviewedByName: 'Davi', ...over,
});

describe('groupOf / groupPeople', () => {
  it('pendente = nunca analisado e sem acesso; desativado = ja analisado e sem acesso', () => {
    expect(groupOf({ active: false, reviewedAt: null })).toBe('pendente');
    expect(groupOf({ active: false, reviewedAt: 'x' })).toBe('desativado');
    expect(groupOf({ active: true, reviewedAt: null })).toBe('ativo');
    expect(groupOf({ active: true, reviewedAt: 'x' })).toBe('ativo');
  });

  it('pedidos mais novos primeiro; os demais por nome (acentos e maiusculas nao atrapalham)', () => {
    const g = groupPeople([
      person({ id: '1', fullName: 'Zé', active: false, reviewedAt: null, createdAt: '2026-10-01T00:00:00Z' }),
      person({ id: '2', fullName: 'Bia', active: false, reviewedAt: null, createdAt: '2026-10-05T00:00:00Z' }),
      person({ id: '3', fullName: 'Éder' }),
      person({ id: '4', fullName: 'ana' }),
      person({ id: '5', fullName: 'Carlos', active: false }),
    ]);
    expect(g.pendente.map((p) => p.id)).toEqual(['2', '1']);
    expect(g.ativo.map((p) => p.id)).toEqual(['4', '3']);
    expect(g.desativado.map((p) => p.id)).toEqual(['5']);
  });
});

describe('patchFor', () => {
  it('aprovar e reativar ativam e fixam o papel; desativar so desativa; papel so muda o papel', () => {
    expect(patchFor({ kind: 'aprovar', role: 'escritorio' })).toEqual({ active: true, role: 'escritorio' });
    expect(patchFor({ kind: 'reativar', role: 'tecnico' })).toEqual({ active: true, role: 'tecnico' });
    expect(patchFor({ kind: 'desativar' })).toEqual({ active: false });
    expect(patchFor({ kind: 'papel', role: 'admin' })).toEqual({ role: 'admin' });
  });
});

describe('confirmText', () => {
  it('toda acao pede confirmacao dizendo quem e o que muda; desativar e rebaixar administrador sao perigosas', () => {
    const p = person();
    expect(confirmText(p, { kind: 'aprovar', role: 'tecnico' })).toMatchObject({ confirmLabel: 'Aprovar', danger: false });
    expect(confirmText(p, { kind: 'aprovar', role: 'tecnico' }).message).toContain('Ana (a@x.com)');
    expect(confirmText(p, { kind: 'desativar' })).toMatchObject({ confirmLabel: 'Desativar', danger: true });
    expect(confirmText(p, { kind: 'desativar' }).message).toMatch(/Nada é apagado/);
    expect(confirmText(person({ role: 'admin' }), { kind: 'papel', role: 'tecnico' }).danger).toBe(true);
    expect(confirmText(p, { kind: 'papel', role: 'admin' }).danger).toBe(false);
    expect(confirmText(p, { kind: 'papel', role: 'admin' }).message).toMatch(/Técnico para Administrador/);
  });

  it('recusar um pedido novo usa "Recusar", sem prometer que dados ja enviados continuam', () => {
    const t = confirmText(person({ active: false, reviewedAt: null }), { kind: 'desativar' });
    expect(t.confirmLabel).toBe('Recusar');
    expect(t.message).not.toMatch(/enviado/);
  });

  it('sem nome: usa o e-mail, nunca "undefined"', () => {
    const t = confirmText(person({ fullName: '' }), { kind: 'aprovar', role: 'tecnico' });
    expect(t.title).toContain('a@x.com');
    expect(t.message).toContain('Sem nome');
  });
});

describe('adminErrorText', () => {
  it('cada tipo de erro tem uma frase propria em portugues', () => {
    const texts = (['network', 'auth', 'denied', 'last-admin', 'other'] as const).map((k) => adminErrorText(new AdminError(k)));
    expect(new Set(texts).size).toBe(5);
    expect(texts[3]).toMatch(/pelo menos um administrador/);
    expect(adminErrorText(new Error('x'))).toBe(texts[4]);
    expect(adminErrorText('texto')).toBe(texts[4]);
  });
});
