import { describe, expect, it } from 'vitest';
import type { Person } from '../admin/adminApi';
import { assignable, roleSuffix } from './assignable';

const P = (id: string, fullName: string, role: Person['role'], active = true): Person => ({ id, email: `${id}@x.test`, fullName, role, active, createdAt: '2026-10-01T00:00:00Z', reviewedAt: null, reviewedByName: null });

describe('assignable', () => {
  it('so tecnico e administrador com acesso, em ordem alfabetica (com acento)', () => {
    const list = [P('1', 'Zeca', 'tecnico'), P('2', 'Ágata', 'tecnico'), P('3', 'Clara', 'escritorio'), P('4', 'Eva', 'tecnico', false), P('5', 'Davi', 'admin'), P('6', 'Bruno', 'tecnico')];
    expect(assignable(list).map((p) => p.fullName)).toEqual(['Ágata', 'Bruno', 'Davi', 'Zeca']);
  });
  it('pessoa sem nome aparece pelo e-mail na ordem', () => {
    expect(assignable([P('b', 'Bia', 'tecnico'), P('a', '', 'tecnico')]).map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('nao altera a lista de entrada', () => {
    const list = [P('1', 'Zeca', 'tecnico'), P('2', 'Ana', 'tecnico')];
    assignable(list);
    expect(list.map((p) => p.id)).toEqual(['1', '2']);
  });
  it('sufixo so para administrador', () => {
    expect(roleSuffix({ role: 'admin' })).toBe(' (administrador)');
    expect(roleSuffix({ role: 'tecnico' })).toBe('');
  });
});
