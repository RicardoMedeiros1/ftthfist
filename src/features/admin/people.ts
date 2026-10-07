import type { Role } from '../account/authApi';
import { AdminError, type Person } from './adminApi';

// Regras de apresentacao da tela Pessoas (puras, testadas sem tela).

export const ROLE_LABEL: Record<Role, string> = { tecnico: 'Técnico', escritorio: 'Escritório', admin: 'Administrador' };
export const ROLE_HELP: Record<Role, string> = {
  tecnico: 'Registra e altera o que é dele; vê o que os outros fizeram.',
  escritorio: 'Só consulta a rede e o histórico; não altera nada.',
  admin: 'Vê e altera tudo, e aprova as pessoas.',
};

export type PersonGroup = 'pendente' | 'ativo' | 'desativado';

/** Pendente = nunca analisado e sem acesso; desativado = analisado e hoje sem acesso. */
export const groupOf = (p: Pick<Person, 'active' | 'reviewedAt'>): PersonGroup => (p.active ? 'ativo' : p.reviewedAt ? 'desativado' : 'pendente');

export function groupPeople(people: Person[]): Record<PersonGroup, Person[]> {
  const byName = (a: Person, b: Person) => a.fullName.localeCompare(b.fullName, 'pt-BR');
  const out: Record<PersonGroup, Person[]> = { pendente: [], ativo: [], desativado: [] };
  for (const p of people) out[groupOf(p)].push(p);
  out.pendente.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // os pedidos mais novos primeiro
  out.ativo.sort(byName);
  out.desativado.sort(byName);
  return out;
}

export type AccessChange =
  | { kind: 'aprovar'; role: Role }
  | { kind: 'reativar'; role: Role }
  | { kind: 'desativar' }
  | { kind: 'papel'; role: Role };

/** O que enviar ao servidor para cada acao. */
export function patchFor(c: AccessChange): { active?: boolean; role?: Role } {
  switch (c.kind) {
    case 'aprovar':
    case 'reativar':
      return { active: true, role: c.role };
    case 'desativar':
      return { active: false };
    case 'papel':
      return { role: c.role };
  }
}

const who = (p: Person) => `${p.fullName || 'Sem nome'} (${p.email})`;

export function confirmText(p: Person, c: AccessChange): { title: string; message: string; confirmLabel: string; danger: boolean } {
  switch (c.kind) {
    case 'aprovar':
      return { title: `Aprovar ${p.fullName || p.email}?`, message: `${who(p)} passa a ter acesso como ${ROLE_LABEL[c.role]}. ${ROLE_HELP[c.role]}`, confirmLabel: 'Aprovar', danger: false };
    case 'reativar':
      return { title: `Reativar ${p.fullName || p.email}?`, message: `${who(p)} volta a ter acesso como ${ROLE_LABEL[c.role]}.`, confirmLabel: 'Reativar', danger: false };
    case 'desativar':
      if (!p.active) {
        return { title: `Recusar ${p.fullName || p.email}?`, message: `${who(p)} fica sem acesso. O pedido pode ser aprovado depois, na lista de desativados.`, confirmLabel: 'Recusar', danger: true };
      }
      if (!p.active) {
        return { title: `Recusar ${p.fullName || p.email}?`, message: `${who(p)} fica sem acesso. O pedido pode ser aprovado depois, na lista de desativados.`, confirmLabel: 'Recusar', danger: true };
      }
      return {
        title: `Desativar ${p.fullName || p.email}?`,
        message: `${who(p)} deixa de enviar e de receber dados. Nada é apagado: o que já foi enviado continua no servidor e o acesso pode ser reativado.`,
        confirmLabel: 'Desativar',
        danger: true,
      };
    case 'papel':
      return {
        title: `Mudar para ${ROLE_LABEL[c.role]}?`,
        message: `${who(p)} passa de ${ROLE_LABEL[p.role]} para ${ROLE_LABEL[c.role]}. ${ROLE_HELP[c.role]}`,
        confirmLabel: 'Mudar papel',
        danger: c.role !== 'admin' && p.role === 'admin',
      };
  }
}

/** Texto para o administrador quando algo da errado. */
export function adminErrorText(e: unknown): string {
  const kind = e instanceof AdminError ? e.kind : 'other';
  switch (kind) {
    case 'network':
      return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    case 'auth':
      return 'Sua sessão venceu. Saia e entre de novo na conta.';
    case 'denied':
      return 'O servidor não permitiu. Só um administrador ativo pode fazer isso.';
    case 'last-admin':
      return 'Precisa existir pelo menos um administrador ativo. Torne outra pessoa administradora antes.';
    case 'invalid':
      return 'O servidor recusou os dados do projeto. Confira se o técnico escolhido está ativo e se os campos estão certos.';
    default:
      return 'Não foi possível concluir. Tente de novo.';
  }
}
