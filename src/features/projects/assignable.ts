import type { Person } from '../admin/adminApi';

/** Quem pode receber um projeto: tecnico ou administrador com acesso, em ordem alfabetica. */
export function assignable(people: readonly Person[]): Person[] {
  return people
    .filter((p) => p.active && (p.role === 'tecnico' || p.role === 'admin'))
    .sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email, 'pt-BR'));
}

export const roleSuffix = (p: Pick<Person, 'role'>) => (p.role === 'admin' ? ' (administrador)' : '');
